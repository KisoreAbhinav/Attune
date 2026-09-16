from __future__ import annotations

import base64
import io
from datetime import date

import pytest
from PIL import Image

from analyzer.model import LocalModel
from analyzer.schemas import (
    AnalyzeRequest,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ExportRequest,
    ScanReport,
    StageRequest,
    ValidationRequest,
)
from main import analyze_scan, chat, export_pdf, health, stage_scan


def report_fixture() -> ScanReport:
    return ScanReport(
        scan_type="xray",
        view="frontal",
        patient_age=42,
        date=date(2026, 9, 16),
        status="complete",
        image_reference="active-session-raster",
        simplified_explanation="The model did not flag a clear abnormal pattern.",
        clinical_summary="No reportable finding crossed the configured threshold.",
        clinical_summary_plain_note="Nothing clear was flagged by the model, but this is not a diagnosis.",
        findings=[],
        impression=[
            {
                "rank": 1,
                "clinical_text": "No finding crossed the configured reporting threshold.",
                "plain_text": "The model did not flag a clear abnormal pattern in this image.",
                "confidence_order": "moderate",
            }
        ],
        impression_plain_note="This result still needs clinical context.",
        recommendations=[
            {
                "id": "clinical-correlation",
                "clinical_text": "Correlate with the clinical history and formal radiology review.",
                "plain_text": "A qualified clinician should review this result.",
            }
        ],
        confidence=0.72,
        uncertainty_note="Model confidence is not diagnostic certainty.",
        model_id="test/local-xray-model",
        disclaimer="Test fixture only. Not a diagnosis.",
    )


class TestModel(LocalModel):
    model_id = "test/local-model"

    def analyze_scan(self, request: AnalyzeRequest) -> ScanReport:
        return report_fixture().model_copy(update={"patient_age": request.age})

    def answer_chat(
        self, report: ScanReport, history: list[ChatMessage], question: str
    ) -> ChatResponse:
        return ChatResponse(
            answer=f"The report says: {report.impression[0].plain_text}",
            confidence="moderate",
            grounded_in_report=True,
            model_id=self.model_id,
        )


class MalformedModel(TestModel):
    def analyze_scan(self, request: AnalyzeRequest) -> object:
        return {"status": "not-a-report"}


def image_base64() -> str:
    image = Image.new("L", (128, 128), color=128)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def test_health() -> None:
    assert health() == {"status": "ok"}


def test_validation_enforces_age_range() -> None:
    payload = {
        "age": 121,
        "scan_mode": "single_image",
        "file_name": "scan.png",
        "file_size": 100,
        "media_type": "image/png",
    }
    with pytest.raises(ValueError):
        ValidationRequest.model_validate(payload)


def test_stage_decodes_image_without_storing_it() -> None:
    payload = {
        "age": 0,
        "scan_mode": "single_image",
        "file_name": "scan.png",
        "file_size": 100,
        "media_type": "image/png",
        "image_base64": image_base64(),
    }
    result = stage_scan(StageRequest.model_validate(payload))
    assert result["stored"] is False
    assert result["width"] == 128


def test_analysis_returns_canonical_report() -> None:
    payload = {
        "age": 42,
        "scan_mode": "single_image",
        "file_name": "scan.png",
        "file_size": 100,
        "media_type": "image/png",
        "image_base64": image_base64(),
        "view": "frontal",
    }
    result = analyze_scan(AnalyzeRequest.model_validate(payload), TestModel())
    assert result.scan_type == "xray"
    assert result.patient_age == 42


def test_malformed_model_output_is_rejected() -> None:
    payload = {
        "age": 42,
        "scan_mode": "single_image",
        "file_name": "scan.png",
        "file_size": 100,
        "media_type": "image/png",
        "image_base64": image_base64(),
        "view": "frontal",
    }
    with pytest.raises(Exception):
        analyze_scan(AnalyzeRequest.model_validate(payload), MalformedModel())


def test_chat_is_stateless_and_structured() -> None:
    response = chat(
        ChatRequest.model_validate(
            {
                "report": report_fixture().model_dump(mode="json"),
                "history": [],
                "question": "What was the impression?",
            }
        ),
        TestModel(),
    )
    assert response.grounded_in_report is True


def test_pdf_export_generates_pdf_from_report() -> None:
    response = export_pdf(
        ExportRequest.model_validate({"report": report_fixture().model_dump(mode="json")})
    )
    assert response.media_type == "application/pdf"
    assert response.body.startswith(b"%PDF")
