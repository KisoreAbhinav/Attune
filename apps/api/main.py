from __future__ import annotations

import io
import os
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from analyzer.model import (
    LocalModel,
    ModelUnavailable,
    decode_image,
    get_chat_model,
    get_xray_model,
)
from analyzer.schemas import (
    AnalyzeRequest,
    ChatRequest,
    ChatResponse,
    ExportRequest,
    ScanReport,
    StageRequest,
    ValidationRequest,
)

app = FastAPI(title="Attune API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("ATTUNE_WEB_ORIGIN", "http://localhost:3000")],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/scan/validate")
def validate_scan(request: ValidationRequest) -> dict[str, object]:
    return {"valid": True, "errors": [], "file_name": request.file_name}


@app.post("/api/scan/stage")
def stage_scan(request: StageRequest) -> dict[str, object]:
    try:
        image = decode_image(request.image_base64)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "valid": True,
        "width": image.width,
        "height": image.height,
        "format": image.format or "decoded-raster",
        "stored": False,
    }


@app.post("/api/scan/analyze", response_model=ScanReport)
def analyze_scan(
    request: AnalyzeRequest,
    model: Annotated[LocalModel, Depends(get_xray_model)],
) -> ScanReport:
    try:
        report = model.analyze_scan(request)
        return ScanReport.model_validate(report)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ModelUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Local X-ray model is unavailable. Check model installation and configuration.",
        ) from exc


@app.post("/api/chat", response_model=ChatResponse)
def chat(
    request: ChatRequest,
    model: Annotated[LocalModel, Depends(get_chat_model)],
) -> ChatResponse:
    try:
        return ChatResponse.model_validate(
            model.answer_chat(request.report, request.history, request.question)
        )
    except ModelUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Local chat model is unavailable. Check model installation and configuration.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _pdf_report(report: ScanReport) -> bytes:
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="Attune X-ray analysis report",
    )
    styles = getSampleStyleSheet()
    story = [
        Paragraph("Attune X-ray analysis report", styles["Title"]),
        Paragraph("Prototype report — not a diagnosis", styles["Normal"]),
        Spacer(1, 8),
        Paragraph(f"Scan: {report.scan_type} · View: {report.view}", styles["Normal"]),
        Paragraph(f"Patient age: {report.patient_age} · Date: {report.date.isoformat()}", styles["Normal"]),
        Paragraph(f"Model: {report.model_id}", styles["Normal"]),
        Spacer(1, 10),
        Paragraph("Plain-language explanation", styles["Heading2"]),
        Paragraph(report.simplified_explanation, styles["BodyText"]),
        Paragraph("Clinical summary", styles["Heading2"]),
        Paragraph(report.clinical_summary, styles["BodyText"]),
        Paragraph(report.clinical_summary_plain_note, styles["BodyText"]),
        Paragraph("Findings", styles["Heading2"]),
    ]
    story.extend(
        Paragraph(f"• {item.clinical_text}<br/>{item.plain_text}", styles["BodyText"])
        for item in report.findings
    )
    if not report.findings:
        story.append(Paragraph("No findings crossed the configured threshold.", styles["BodyText"]))
    story.extend([Paragraph("Impression", styles["Heading2"])])
    story.extend(
        Paragraph(f"{item.rank}. {item.clinical_text}<br/>{item.plain_text}", styles["BodyText"])
        for item in report.impression
    )
    story.extend([Paragraph("Recommendations", styles["Heading2"])])
    story.extend(
        Paragraph(f"• {item.clinical_text}<br/>{item.plain_text}", styles["BodyText"])
        for item in report.recommendations
    )
    story.extend(
        [
            Paragraph("Uncertainty", styles["Heading2"]),
            Paragraph(report.uncertainty_note, styles["BodyText"]),
            Spacer(1, 10),
            Paragraph(report.disclaimer, styles["Italic"]),
        ]
    )
    document.build(story)
    return buffer.getvalue()


@app.post("/api/export/pdf")
def export_pdf(request: ExportRequest) -> Response:
    try:
        report = ScanReport.model_validate(request.report)
        payload = _pdf_report(report)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=payload,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=attune-xray-report.pdf"},
    )
