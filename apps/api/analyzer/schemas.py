from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class IntakeMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    age: int = Field(ge=0, le=120)
    gender: str | None = Field(default=None, max_length=80)
    clinical_notes: str | None = Field(default=None, max_length=4000)
    scan_mode: Literal["single_image", "dicom"]
    file_name: str = Field(min_length=1, max_length=255)
    file_size: int = Field(gt=0, le=20 * 1024 * 1024)
    media_type: str = Field(min_length=1, max_length=120)


class ValidationRequest(IntakeMetadata):
    pass


class StageRequest(IntakeMetadata):
    image_base64: str = Field(min_length=32)


class AnalyzeRequest(StageRequest):
    scan_type: Literal["xray", "brain_mri", "knee_mri"] = "xray"
    view: str = Field(default="frontal", min_length=1, max_length=80)


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80)
    clinical_text: str = Field(min_length=1, max_length=500)
    plain_text: str = Field(min_length=1, max_length=500)
    confidence: float = Field(ge=0, le=1)
    uncertain: bool = False


class Impression(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rank: int = Field(ge=1, le=10)
    clinical_text: str = Field(min_length=1, max_length=500)
    plain_text: str = Field(min_length=1, max_length=500)
    confidence_order: Literal["high", "moderate", "low", "indeterminate"]


class Recommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=80)
    clinical_text: str = Field(min_length=1, max_length=500)
    plain_text: str = Field(min_length=1, max_length=500)


class ScanReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scan_type: Literal["xray", "brain_mri", "knee_mri"]
    view: str = Field(min_length=1, max_length=80)
    patient_age: int = Field(ge=0, le=120)
    date: date
    status: Literal["complete", "indeterminate", "insufficient_image"]
    image_reference: Literal["active-session-raster"]
    simplified_explanation: str = Field(min_length=1, max_length=1200)
    clinical_summary: str = Field(min_length=1, max_length=1200)
    clinical_summary_plain_note: str = Field(min_length=1, max_length=1200)
    findings: list[Finding] = Field(max_length=20)
    impression: list[Impression] = Field(min_length=1, max_length=10)
    impression_plain_note: str = Field(min_length=1, max_length=1200)
    recommendations: list[Recommendation] = Field(max_length=10)
    confidence: float = Field(ge=0, le=1)
    uncertainty_note: str = Field(min_length=1, max_length=1200)
    model_id: str = Field(min_length=1, max_length=255)
    disclaimer: str = Field(min_length=1, max_length=1200)

    @field_validator("findings")
    @classmethod
    def finding_ids_are_unique(cls, value: list[Finding]) -> list[Finding]:
        ids = [finding.id for finding in value]
        if len(ids) != len(set(ids)):
            raise ValueError("finding ids must be unique")
        return value


class AnalyzeResponse(ScanReport):
    pass


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report: ScanReport
    history: list[ChatMessage] = Field(default_factory=list, max_length=12)
    question: str = Field(min_length=1, max_length=1000)


class ChatResponse(BaseModel):
    answer: str = Field(min_length=1, max_length=2000)
    confidence: Literal["high", "moderate", "low"]
    grounded_in_report: bool
    model_id: str = Field(min_length=1, max_length=255)


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report: ScanReport
