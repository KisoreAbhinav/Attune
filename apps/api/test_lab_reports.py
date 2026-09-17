import asyncio
from io import BytesIO
from types import SimpleNamespace

import httpx2
import pymupdf
from PIL import Image

import lab_reports
from main import app


def request(method: str, path: str, **kwargs) -> httpx2.Response:
    async def send():
        async with httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url="http://test"
        ) as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(send())


def jpeg_file() -> tuple[str, bytes, str]:
    output = BytesIO()
    Image.new("RGB", (2, 2), "white").save(output, format="JPEG")
    return ("report.jpg", output.getvalue(), "image/jpeg")


def valid_result() -> dict:
    return {
        "tests": [
            {
                "name": "Haemoglobin",
                "value": "10.2",
                "unit": "g/dL",
                "reference_range": "12.0–15.5",
                "flag": "Low",
                "confidence": "high",
                "source_page": 1,
                "explanation": {
                    "summary": "The reported value is below the range printed by the lab.",
                    "common_reasons": ["Results can vary with hydration and individual context."],
                },
            }
        ],
        "warnings": [],
        "questions_for_clinician": ["How should this result be interpreted with my history?"],
        "disclaimer": "Educational information only; not a diagnosis or treatment recommendation.",
    }


def configure(monkeypatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setenv("GROQ_API_KEY", "groq-secret")


def test_health_reports_configuration_without_secrets(monkeypatch):
    configure(monkeypatch)

    response = request("GET", "/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "ai": {"primary": "gemini", "configured": ["gemini", "groq"]},
    }
    assert "secret" not in response.text


def test_rejects_unsupported_file_type(monkeypatch):
    configure(monkeypatch)

    response = request(
        "POST",
        "/lab-reports/analyze",
        files={"file": ("notes.txt", b"not a report", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "unsupported_file_type"


def test_rejects_malformed_image(monkeypatch):
    configure(monkeypatch)

    response = request(
        "POST",
        "/lab-reports/analyze",
        files={"file": ("report.png", b"not an image", "image/png")},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_file"


def test_rejects_pdf_over_ten_pages(monkeypatch):
    configure(monkeypatch)
    document = pymupdf.open()
    for _ in range(11):
        document.new_page()
    payload = document.tobytes()
    document.close()

    response = request(
        "POST",
        "/lab-reports/analyze",
        files={"file": ("report.pdf", payload, "application/pdf")},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "too_many_pages"


def test_requires_a_configured_provider(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    response = request("POST", "/lab-reports/analyze", files={"file": jpeg_file()})

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "provider_not_configured"


def test_transient_failure_uses_alternate_provider_once(monkeypatch):
    configure(monkeypatch)
    calls: list[str] = []

    def gemini(_images):
        calls.append("gemini")
        raise lab_reports.TransientProviderError

    def groq(_images):
        calls.append("groq")
        return valid_result()

    monkeypatch.setattr(lab_reports, "provider_calls", {"gemini": gemini, "groq": groq})

    response = request("POST", "/lab-reports/analyze", files={"file": jpeg_file()})

    assert response.status_code == 200
    assert response.json()["tests"][0]["reference_range"] == "12.0–15.5"
    assert calls == ["gemini", "groq"]


def test_schema_failure_does_not_use_alternate_provider(monkeypatch):
    configure(monkeypatch)
    calls: list[str] = []

    def gemini(_images):
        calls.append("gemini")
        return {"tests": [{"name": ""}]}

    def groq(_images):
        calls.append("groq")
        return valid_result()

    monkeypatch.setattr(lab_reports, "provider_calls", {"gemini": gemini, "groq": groq})

    response = request("POST", "/lab-reports/analyze", files={"file": jpeg_file()})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_provider_response"
    assert calls == ["gemini"]


def test_gemini_uses_json_mode_without_generated_response_schema(monkeypatch):
    captured = {}

    class Models:
        def generate_content(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(text="{}")

    monkeypatch.setenv("GEMINI_API_KEY", "gemini-secret")
    monkeypatch.setattr(lab_reports.genai, "Client", lambda **_kwargs: SimpleNamespace(models=Models()))

    lab_reports._gemini([b"image"])

    assert captured["config"].response_mime_type == "application/json"
    assert captured["config"].response_json_schema is None
