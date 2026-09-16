from __future__ import annotations

import base64
import binascii
import io
import os
from abc import ABC, abstractmethod
from datetime import date
from typing import Any

from PIL import Image, ImageStat

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


def get_chat_model() -> LocalModel:
    return HuggingFaceChatModel()
