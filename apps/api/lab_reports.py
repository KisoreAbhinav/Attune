import base64
import os
from collections.abc import Callable
from io import BytesIO
from typing import Annotated, Literal

import pymupdf
from fastapi import APIRouter, File, HTTPException, UploadFile
from google import genai
from google.genai import errors as google_errors
from google.genai import types as google_types
from groq import APIConnectionError, APIStatusError, APITimeoutError, Groq, RateLimitError
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 10
SUPPORTED_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MODELS = {
    "gemini": "gemini-2.5-flash",
    "groq": "meta-llama/llama-4-scout-17b-16e-instruct",
}

PROMPT = """You explain consumer lab reports for educational use. Read only the attached report pages.

Return valid JSON only. Use this shape: {"tests":[{"name":"","value":"","unit":"","reference_range":"","flag":"","confidence":"high|medium|low","warning":"","source_page":1,"explanation":{"summary":"","common_reasons":[""]}}],"warnings":[""],"questions_for_clinician":[""],"disclaimer":""}. `name`, `confidence`, `tests`, `warnings`, `questions_for_clinician`, and `disclaimer` are required. Omit uncertain optional fields instead of using empty strings. Extract only clearly observable lab tests. Preserve printed values, units, reference ranges, flags, and page numbers exactly. Never supply your own clinical reference range.

For values the report itself marks out of range, add a short plain-language explanation, common explicitly non-exclusive reasons the value may vary, and useful questions for a clinician. Do not name or diagnose diseases. Do not recommend treatment. Do not determine that any value is an emergency. A critical flag may be copied only when it is visibly printed by the lab. Keep the disclaimer explicit: educational information only, not diagnosis or treatment advice. If no supported lab values are legible, return an empty tests list and explain why in warnings."""


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FlagExplanation(StrictModel):
    summary: Annotated[str, Field(min_length=1, max_length=600)]
    common_reasons: Annotated[list[str], Field(max_length=6)] = []


class LabTest(StrictModel):
    name: Annotated[str, Field(min_length=1, max_length=160)]
    value: Annotated[str | None, Field(max_length=120)] = None
    unit: Annotated[str | None, Field(max_length=80)] = None
    reference_range: Annotated[str | None, Field(max_length=160)] = None
    flag: Annotated[str | None, Field(max_length=80)] = None
    confidence: Literal["high", "medium", "low"]
    warning: Annotated[str | None, Field(max_length=300)] = None
    source_page: Annotated[int | None, Field(ge=1, le=MAX_PDF_PAGES)] = None
    explanation: FlagExplanation | None = None

    @model_validator(mode="after")
    def explanation_requires_printed_flag(self):
        if self.explanation and not self.flag:
            raise ValueError("explanation requires a printed flag")
        return self


class AnalysisResult(StrictModel):
    tests: Annotated[list[LabTest], Field(max_length=200)]
    warnings: Annotated[list[str], Field(max_length=20)]
    questions_for_clinician: Annotated[list[str], Field(max_length=10)]
    disclaimer: Annotated[str, Field(min_length=1, max_length=400)]


class TransientProviderError(Exception):
    pass


class ProvidersUnavailable(Exception):
    pass


def configured_providers() -> list[str]:
    return [name for name in ("gemini", "groq") if os.getenv(f"{name.upper()}_API_KEY")]


def primary_provider() -> str:
    selected = os.getenv("AI_PROVIDER", "gemini").lower()
    return selected if selected in MODELS else "gemini"


def provider_order(configured: list[str]) -> list[str]:
    primary = primary_provider()
    return sorted(configured, key=lambda name: name != primary)


def normalize_upload(content_type: str, data: bytes) -> list[bytes]:
    if content_type == "application/pdf":
        try:
            document = pymupdf.open(stream=data, filetype="pdf")
        except Exception as error:
            raise HTTPException(400, {"code": "invalid_file", "message": "PDF could not be read."}) from error
        try:
            if document.page_count == 0:
                raise HTTPException(400, {"code": "invalid_file", "message": "PDF has no pages."})
            if document.page_count > MAX_PDF_PAGES:
                raise HTTPException(
                    400,
                    {"code": "too_many_pages", "message": f"PDFs may contain at most {MAX_PDF_PAGES} pages."},
                )
            return [page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5), alpha=False).tobytes("png") for page in document]
        finally:
            document.close()

    try:
        image = Image.open(BytesIO(data))
        image.verify()
        image = Image.open(BytesIO(data)).convert("RGB")
        output = BytesIO()
        image.save(output, format="PNG")
        return [output.getvalue()]
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise HTTPException(400, {"code": "invalid_file", "message": "Image could not be read."}) from error


def _parse_result(payload: str | dict) -> AnalysisResult:
    try:
        result = AnalysisResult.model_validate_json(payload) if isinstance(payload, str) else AnalysisResult.model_validate(payload)
    except (ValidationError, ValueError, TypeError) as error:
        raise HTTPException(
            422,
            {"code": "invalid_provider_response", "message": "The report could not be analyzed safely."},
        ) from error
    if not result.tests:
        raise HTTPException(
            422,
            {"code": "no_lab_values", "message": "No supported lab values were found in this document."},
        )
    return result


def _gemini(images: list[bytes]) -> str:
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    contents = [google_types.Part.from_bytes(data=image, mime_type="image/png") for image in images]
    contents.append(PROMPT)
    try:
        response = client.models.generate_content(
            model=MODELS["gemini"],
            contents=contents,
            config=google_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0,
            ),
        )
    except google_errors.APIError as error:
        if error.code == 429 or error.code >= 500:
            raise TransientProviderError from error
        raise HTTPException(502, {"code": "provider_error", "message": "Provider rejected the report."}) from error
    if not response.text:
        raise HTTPException(422, {"code": "invalid_provider_response", "message": "Provider returned no analysis."})
    return response.text


def _groq(images: list[bytes]) -> str:
    visual_parts = [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64.b64encode(image).decode()}"}}
        for image in images
    ]
    try:
        response = Groq(api_key=os.environ["GROQ_API_KEY"]).chat.completions.create(
            model=MODELS["groq"],
            messages=[{"role": "user", "content": [{"type": "text", "text": PROMPT}, *visual_parts]}],
            response_format={"type": "json_object"},
            temperature=0,
        )
    except (RateLimitError, APITimeoutError, APIConnectionError) as error:
        raise TransientProviderError from error
    except APIStatusError as error:
        if error.status_code >= 500:
            raise TransientProviderError from error
        raise HTTPException(502, {"code": "provider_error", "message": "Provider rejected the report."}) from error
    content = response.choices[0].message.content
    if not content:
        raise HTTPException(422, {"code": "invalid_provider_response", "message": "Provider returned no analysis."})
    return content


provider_calls: dict[str, Callable[[list[bytes]], str | dict]] = {"gemini": _gemini, "groq": _groq}


def analyze_with_fallback(images: list[bytes]) -> AnalysisResult:
    configured = configured_providers()
    if not configured:
        raise HTTPException(
            503,
            {"code": "provider_not_configured", "message": "Report analysis is not configured yet."},
        )
    order = provider_order(configured)
    for index, name in enumerate(order):
        try:
            return _parse_result(provider_calls[name](images))
        except TransientProviderError:
            if index + 1 == len(order):
                raise ProvidersUnavailable
    raise ProvidersUnavailable


router = APIRouter(prefix="/lab-reports", tags=["lab reports"])


@router.post("/analyze", response_model=AnalysisResult)
async def analyze_lab_report(file: Annotated[UploadFile, File()]):
    if file.content_type not in SUPPORTED_TYPES:
        raise HTTPException(
            400,
            {"code": "unsupported_file_type", "message": "Use a JPG, PNG, or PDF report."},
        )
    data = file.file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(400, {"code": "file_too_large", "message": "Reports may be up to 10 MB."})
    images = normalize_upload(file.content_type, data)
    try:
        return analyze_with_fallback(images)
    except ProvidersUnavailable as error:
        raise HTTPException(
            503,
            {"code": "providers_unavailable", "message": "Analysis is temporarily unavailable. Try again later."},
        ) from error
