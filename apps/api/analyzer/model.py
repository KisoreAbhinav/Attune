from __future__ import annotations

import base64
import binascii
import io
import json
import os
from abc import ABC, abstractmethod
from datetime import date
from functools import lru_cache
from typing import Any

from PIL import Image, ImageStat
import httpx

from .schemas import AnalyzeRequest, ChatMessage, ChatResponse, ScanReport


class ModelUnavailable(RuntimeError):
    """Raised when a configured local model cannot be loaded or used."""


class LocalModel(ABC):
    model_id: str

    @abstractmethod
    def analyze_scan(self, request: AnalyzeRequest) -> ScanReport:
        raise NotImplementedError

    @abstractmethod
    def answer_chat(
        self, report: ScanReport, history: list[ChatMessage], question: str
    ) -> ChatResponse:
        raise NotImplementedError


def decode_image(image_base64: str) -> Image.Image:
    try:
        raw = base64.b64decode(image_base64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("image payload is not valid base64") from exc
    if not raw:
        raise ValueError("image payload is empty")
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:
        raise ValueError("image payload could not be decoded") from exc
    return image.convert("RGB")


def compact_image_payload(image_base64: str) -> str:
    """Reduce oversized raster inputs before a remote processing request."""
    image = decode_image(image_base64)
    maximum_side = int(os.getenv("ATTUNE_PROCESSING_MAX_SIDE", "1536"))
    image.thumbnail((maximum_side, maximum_side), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=88, optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


class HuggingFaceXrayModel(LocalModel):
    """Lazy local Transformers adapter for a multi-label chest X-ray model."""

    labels = (
        "No Finding",
        "Atelectasis",
        "Cardiomegaly",
        "Effusion",
        "Infiltration",
        "Mass",
        "Nodule",
        "Pneumonia",
        "Pneumothorax",
        "Consolidation",
        "Edema",
        "Emphysema",
        "Fibrosis",
        "Pleural Thickening",
        "Hernia",
    )

    plain_language = {
        "Atelectasis": "A small area of the lung may not be fully expanded.",
        "Cardiomegaly": "The heart silhouette appears larger than expected on this image.",
        "Effusion": "There may be extra fluid around the lung.",
        "Infiltration": "The model identified a less-specific change in the lung markings.",
        "Mass": "A focal area that needs clinical correlation was identified.",
        "Nodule": "A small rounded opacity was identified for clinical correlation.",
        "Pneumonia": "The model identified a pattern that can occur with infection.",
        "Pneumothorax": "The model identified a pattern that can occur when air collects around the lung.",
        "Consolidation": "A denser region of lung tissue was identified.",
        "Edema": "The model identified a pattern that can occur with fluid in the lungs.",
        "Emphysema": "The model identified a pattern associated with chronic air trapping.",
        "Fibrosis": "The model identified a pattern of possible scarring in the lungs.",
        "Pleural Thickening": "The lining around the lung may appear thickened.",
        "Hernia": "A possible diaphragmatic contour change was identified.",
    }

    def __init__(self) -> None:
        self.model_id = os.getenv(
            "HF_XRAY_MODEL_ID", "tta1301/xray-vit-classifier-v3"
        )
        self._processor: Any | None = None
        self._model: Any | None = None

    def _load(self) -> tuple[Any, Any]:
        if self._processor is not None and self._model is not None:
            return self._processor, self._model
        try:
            from transformers import AutoImageProcessor, AutoModelForImageClassification
        except ImportError as exc:
            raise ModelUnavailable(
                "transformers is not installed; install the API model dependencies"
            ) from exc
        try:
            cache_dir = os.getenv("HF_CACHE_DIR") or None
            self._processor = AutoImageProcessor.from_pretrained(
                self.model_id, cache_dir=cache_dir
            )
            self._model = AutoModelForImageClassification.from_pretrained(
                self.model_id, cache_dir=cache_dir
            )
            self._model.eval()
        except Exception as exc:
            raise ModelUnavailable(
                f"the local X-ray model '{self.model_id}' could not be loaded"
            ) from exc
        return self._processor, self._model

    def analyze_scan(self, request: AnalyzeRequest) -> ScanReport:
        image = decode_image(request.image_base64)
        if min(image.size) < 64:
            return self._insufficient_report(request)
        if ImageStat.Stat(image.convert("L")).var < 1:
            return self._insufficient_report(request)
        processor, model = self._load()
        try:
            import torch

            inputs = processor(images=image, return_tensors="pt")
            with torch.inference_mode():
                logits = model(**inputs).logits[0]
                probabilities = torch.sigmoid(logits).tolist()
        except Exception as exc:
            raise ModelUnavailable("local X-ray inference failed") from exc

        configured_labels = getattr(model.config, "id2label", {})
        labels = [
            str(configured_labels.get(index, self.labels[index] if index < len(self.labels) else index))
            for index in range(len(probabilities))
        ]
        scored = sorted(zip(labels, probabilities), key=lambda item: item[1], reverse=True)
        findings = [
            (label, float(score))
            for label, score in scored
            if label.lower() not in {"no finding", "no_finding"} and score >= 0.3
        ][:5]
        top_score = float(scored[0][1]) if scored else 0.0
        is_indeterminate = not findings and 0.3 <= top_score < 0.6
        status = "indeterminate" if is_indeterminate else "complete"
        report_findings = [
            {
                "id": label.lower().replace(" ", "-"),
                "clinical_text": f"Possible {label.lower()} pattern detected by the local model.",
                "plain_text": self.plain_language.get(
                    label, "A possible imaging pattern was identified for review."
                ),
                "confidence": score,
                "uncertain": score < 0.6,
            }
            for label, score in findings
        ]
        if report_findings:
            impression = [
                {
                    "rank": index,
                    "clinical_text": item["clinical_text"],
                    "plain_text": item["plain_text"],
                    "confidence_order": "moderate" if item["confidence"] < 0.75 else "high",
                }
                for index, item in enumerate(report_findings[:3], start=1)
            ]
            summary = "The local model identified one or more patterns for clinician review."
            plain_summary = "The scan contains patterns that should be reviewed with the full clinical context."
        else:
            impression = [
                {
                    "rank": 1,
                    "clinical_text": "No finding crossed the configured reporting threshold.",
                    "plain_text": "The model did not flag a clear abnormal pattern in this image.",
                    "confidence_order": "indeterminate" if is_indeterminate else "moderate",
                }
            ]
            summary = "No reportable finding crossed the configured model threshold."
            plain_summary = "Nothing clear was flagged by the model, but this is not a diagnosis."
        return ScanReport(
            scan_type="xray",
            view=request.view,
            patient_age=request.age,
            date=date.today(),
            status=status,
            image_reference="active-session-raster",
            simplified_explanation=plain_summary,
            clinical_summary=summary,
            clinical_summary_plain_note=plain_summary,
            findings=report_findings,
            impression=impression,
            impression_plain_note=plain_summary,
            recommendations=[
                {
                    "id": "clinical-correlation",
                    "clinical_text": "Correlate these model outputs with the clinical history and formal radiology review.",
                    "plain_text": "A qualified clinician should review this result with the patient’s symptoms and history.",
                }
            ],
            confidence=top_score,
            uncertainty_note=(
                "The leading model signal is below the high-confidence range; treat this output as indeterminate."
                if is_indeterminate
                else "Model confidence is not equivalent to diagnostic certainty."
            ),
            model_id=self.model_id,
            disclaimer="Prototype output from a locally installed Hugging Face model. Not a diagnosis or substitute for clinical care.",
        )

    def _insufficient_report(self, request: AnalyzeRequest) -> ScanReport:
        return ScanReport(
            scan_type="xray",
            view=request.view,
            patient_age=request.age,
            date=date.today(),
            status="insufficient_image",
            image_reference="active-session-raster",
            simplified_explanation="The image does not contain enough usable visual information for this model.",
            clinical_summary="Image quality was insufficient for local model inference.",
            clinical_summary_plain_note="Please provide a clear X-ray image with adequate resolution and contrast.",
            findings=[],
            impression=[
                {
                    "rank": 1,
                    "clinical_text": "Image quality is insufficient for interpretation.",
                    "plain_text": "The image needs to be replaced or reviewed directly by a clinician.",
                    "confidence_order": "indeterminate",
                }
            ],
            impression_plain_note="No finding should be inferred from this image.",
            recommendations=[
                {
                    "id": "replace-image",
                    "clinical_text": "Repeat or replace the input with a diagnostically adequate image.",
                    "plain_text": "Try a clearer image or ask a clinician to review the original study.",
                }
            ],
            confidence=0.0,
            uncertainty_note="No diagnostic conclusion can be drawn from an insufficient image.",
            model_id=self.model_id,
            disclaimer="Prototype output from a locally installed Hugging Face model. Not a diagnosis or substitute for clinical care.",
        )


class HuggingFaceChatModel(LocalModel):
    def __init__(self) -> None:
        self.model_id = os.getenv(
            "HF_CHAT_MODEL_ID", "HuggingFaceTB/SmolLM2-360M-Instruct"
        )
        self._pipeline: Any | None = None

    def _load(self) -> Any:
        if self._pipeline is not None:
            return self._pipeline
        try:
            from transformers import pipeline

            cache_dir = os.getenv("HF_CACHE_DIR") or None
            self._pipeline = pipeline(
                "text-generation", model=self.model_id, device=os.getenv("HF_DEVICE", "cpu"),
                model_kwargs={"cache_dir": cache_dir} if cache_dir else {},
            )
        except Exception as exc:
            raise ModelUnavailable(
                f"the local chat model '{self.model_id}' could not be loaded"
            ) from exc
        return self._pipeline

    def analyze_scan(self, request: AnalyzeRequest) -> ScanReport:
        raise ModelUnavailable("the configured chat model cannot analyze scans")

    def answer_chat(
        self, report: ScanReport, history: list[ChatMessage], question: str
    ) -> ChatResponse:
        pipeline = self._load()
        context = report.model_dump_json(exclude={"image_reference"})
        conversation = "\n".join(f"{item.role}: {item.content}" for item in history[-6:])
        prompt = (
            "Answer only from the supplied report. If the report does not contain the answer, say that it is not available. "
            "Do not diagnose, invent symptoms, or claim access to other records. Keep the answer concise.\n\n"
            f"REPORT JSON:\n{context}\n\nCONVERSATION:\n{conversation}\nuser: {question}\nassistant:"
        )
        try:
            result = pipeline(prompt, max_new_tokens=180, do_sample=False, return_full_text=False)
            answer = str(result[0]["generated_text"]).strip()
        except Exception as exc:
            raise ModelUnavailable("local chat inference failed") from exc
        if not answer:
            raise ModelUnavailable("local chat model returned an empty answer")
        return ChatResponse(
            answer=answer,
            confidence="moderate",
            grounded_in_report=True,
            model_id=self.model_id,
        )


def get_xray_model() -> LocalModel:
    return HuggingFaceXrayModel()


class GeminiMedicalModel(LocalModel):
    """Server-side Gemini adapter for the three supported raster scan types."""

    def __init__(self) -> None:
        self.model_id = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
        self.api_key = os.getenv("GEMINI_API_KEY")
        self._client = httpx.Client(timeout=httpx.Timeout(20.0, connect=5.0))

    def analyze_scan(self, request: AnalyzeRequest) -> ScanReport:
        if not self.api_key:
            raise ModelUnavailable("GEMINI_API_KEY is not configured on the API server")
        scan_name = {"xray": "chest X-ray", "brain_mri": "brain MRI", "knee_mri": "knee MRI"}[request.scan_type]
        visual_checklist = {
            "xray": "Inspect both lungs, including the upper lobes, for focal or patchy opacity, infiltrate, consolidation, nodular or reticular patterns, asymmetry, pleural abnormality, and cardiac silhouette.",
            "brain_mri": "Inspect symmetry, ventricles, parenchymal signal, mass effect, edema, focal lesions, and visible extra-axial spaces.",
            "knee_mri": "Inspect menisci, cruciate and collateral ligaments, cartilage, marrow signal, joint fluid, and visible periarticular soft tissues.",
        }[request.scan_type]
        prompt = f"""Provide a compact, non-diagnostic educational review of this {scan_name}.
First decide whether the image is technically adequate, then systematically review visible positive and negative patterns. {visual_checklist} Do not call the image normal merely because one specific sign is absent. Put visible positive patterns first and describe only what the pixels support.
Use cautious language. Do not diagnose. The status describes processing completeness, not normality: use complete for an adequate image, indeterminate for genuinely equivocal output, and insufficient_image only for inadequate image quality. Return JSON only with: status, simplified_explanation, clinical_summary, clinical_summary_plain_note, findings, impression, impression_plain_note, recommendations, confidence, uncertainty_note. Use at most 3 findings and 3 recommendations. Every finding needs id, clinical_text, plain_text, confidence (0-1), uncertain. Every impression needs rank, clinical_text, plain_text, confidence_order (high/moderate/low/indeterminate). Every recommendation needs id, clinical_text, plain_text. State that a clinician must review the original study.
Age: {request.age}. Notes: {request.clinical_notes or 'none'}."""
        payload = {
            "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": compact_image_payload(request.image_base64)}}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "maxOutputTokens": 1000,
                "thinkingConfig": {"thinkingLevel": "minimal"},
                "responseJsonSchema": {
                    "type": "object",
                    "required": ["status", "simplified_explanation", "clinical_summary", "clinical_summary_plain_note", "findings", "impression", "impression_plain_note", "recommendations", "confidence", "uncertainty_note"],
                    "properties": {
                        "status": {"type": "string", "enum": ["complete", "indeterminate", "insufficient_image"]},
                        "simplified_explanation": {"type": "string"},
                        "clinical_summary": {"type": "string"},
                        "clinical_summary_plain_note": {"type": "string"},
                        "findings": {"type": "array", "maxItems": 3, "items": {"type": "object", "required": ["id", "clinical_text", "plain_text", "confidence", "uncertain"], "properties": {"id": {"type": "string"}, "clinical_text": {"type": "string"}, "plain_text": {"type": "string"}, "confidence": {"type": "number", "minimum": 0, "maximum": 1}, "uncertain": {"type": "boolean"}}}},
                        "impression": {"type": "array", "minItems": 1, "maxItems": 3, "items": {"type": "object", "required": ["rank", "clinical_text", "plain_text", "confidence_order"], "properties": {"rank": {"type": "integer"}, "clinical_text": {"type": "string"}, "plain_text": {"type": "string"}, "confidence_order": {"type": "string", "enum": ["high", "moderate", "low", "indeterminate"]}}}},
                        "impression_plain_note": {"type": "string"},
                        "recommendations": {"type": "array", "maxItems": 3, "items": {"type": "object", "required": ["id", "clinical_text", "plain_text"], "properties": {"id": {"type": "string"}, "clinical_text": {"type": "string"}, "plain_text": {"type": "string"}}}},
                        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                        "uncertainty_note": {"type": "string"},
                    },
                },
            },
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_id}:generateContent"
        try:
            response = self._client.post(url, headers={"x-goog-api-key": self.api_key}, json=payload)
            response.raise_for_status()
            body = response.json()
            text = body["candidates"][0]["content"]["parts"][0]["text"]
            result = json.loads(text)
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500].replace(self.api_key or "", "[redacted]")
            raise ModelUnavailable(f"processing provider returned HTTP {exc.response.status_code}: {detail}") from exc
        except (httpx.HTTPError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise ModelUnavailable(f"processing provider returned an invalid response ({type(exc).__name__})") from exc
        # Gemini may use descriptive status values such as "abnormal" despite the
        # requested vocabulary. Normalize them before enforcing our API contract.
        reported_status = str(result.get("status", "indeterminate")).lower()
        result["status"] = {
            "normal": "complete",
            "abnormal": "complete",
            "complete": "complete",
            "indeterminate": "indeterminate",
            "insufficient_image": "insufficient_image",
        }.get(reported_status, "indeterminate")
        raw_findings = result.get("findings") if isinstance(result.get("findings"), list) else []
        result["findings"] = [
            {
                "id": str(item.get("id", index)),
                "clinical_text": str(item.get("clinical_text") or item.get("finding") or "Possible imaging pattern for review."),
                "plain_text": str(item.get("plain_text") or item.get("explanation") or item.get("clinical_text") or "A possible pattern was returned for clinician review."),
                "confidence": max(0.0, min(1.0, float(item.get("confidence", 0.0)))),
                "uncertain": bool(item.get("uncertain", float(item.get("confidence", 0.0)) < 0.75)),
            }
            for index, item in enumerate(raw_findings, start=1)
            if isinstance(item, dict)
        ][:20]
        raw_impression = result.get("impression") if isinstance(result.get("impression"), list) else []
        result["impression"] = [
            {
                "rank": index,
                "clinical_text": str(item.get("clinical_text") or item.get("impression") or "Image requires clinician review."),
                "plain_text": str(item.get("plain_text") or item.get("explanation") or item.get("clinical_text") or "A qualified clinician should review the original study."),
                "confidence_order": str(item.get("confidence_order", "indeterminate")).lower() if str(item.get("confidence_order", "indeterminate")).lower() in {"high", "moderate", "low", "indeterminate"} else "indeterminate",
            }
            for index, item in enumerate(raw_impression, start=1)
            if isinstance(item, dict)
        ][:10] or [{"rank": 1, "clinical_text": "Image requires clinician review.", "plain_text": "This result is not a diagnosis.", "confidence_order": "indeterminate"}]
        raw_recommendations = result.get("recommendations") if isinstance(result.get("recommendations"), list) else []
        result["recommendations"] = [
            {
                "id": str(item.get("id", index)),
                "clinical_text": str(item.get("clinical_text") or item.get("recommendation") or "Review with a qualified clinician."),
                "plain_text": str(item.get("plain_text") or item.get("clinical_text") or "A qualified clinician should review the original study."),
            }
            for index, item in enumerate(raw_recommendations, start=1)
            if isinstance(item, dict)
        ][:10]
        result["confidence"] = max(0.0, min(1.0, float(result.get("confidence", max((item["confidence"] for item in result["findings"]), default=0.0)))))
        result["uncertainty_note"] = str(result.get("uncertainty_note") or "Processing confidence is not diagnostic certainty.")
        result.update({
            "scan_type": request.scan_type,
            "view": request.view,
            "patient_age": request.age,
            "date": date.today().isoformat(),
            "image_reference": "active-session-raster",
            "model_id": self.model_id,
            "disclaimer": "Prototype output for educational use only. Not a diagnosis or substitute for a radiologist or clinician.",
        })
        try:
            return ScanReport.model_validate(result)
        except ValueError as exc:
            raise ModelUnavailable(f"Processing response did not match the required format: {exc}") from exc

    def answer_chat(self, report: ScanReport, history: list[ChatMessage], question: str) -> ChatResponse:
        raise ModelUnavailable("Gemini scan analysis does not provide follow-up chat")


@lru_cache(maxsize=1)
def get_gemini_model() -> LocalModel:
    return GeminiMedicalModel()


def get_chat_model() -> LocalModel:
    return HuggingFaceChatModel()
