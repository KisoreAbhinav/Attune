# Attune X-ray Analyzer

## Architecture

The analyzer is mounted at `/app/x-ray` and is composed from the existing Next.js App Router, Tailwind tokens, and shadcn primitives. The browser keeps the active file, parsed DICOM state, report, and chat history in React state only. The FastAPI API does not create sessions, databases, uploads, or persistent records.

The browser parses supported uncompressed DICOM files and rasterizes the selected frame to a PNG only when the user starts analysis. The viewer supports frame selection, window/level, zoom, pan, crosshair, orientation markers, click measurements, and annotations. Compressed or unsupported transfer syntaxes are rejected with a recoverable error.

## Local model boundary

`apps/api/analyzer/model.py` contains the model boundary. Production analysis uses `HuggingFaceXrayModel`, which lazily loads a Transformers image-classification model from `HF_XRAY_MODEL_ID`. The default is `tta1301/xray-vit-classifier-v3`, a multi-label chest X-ray classifier with an Apache-2.0 model card. Its logits are converted into the canonical `ScanReport` schema; no prose parsing or fabricated fallback is used.

Follow-up chat uses a separate local Transformers text-generation model configured by `HF_CHAT_MODEL_ID`, defaulting to `HuggingFaceTB/SmolLM2-360M-Instruct`. The prompt includes only the report and in-memory history. Tests inject deterministic adapters through FastAPI dependency overrides; those adapters are never selected by production routes.

Model weights are downloaded into the Hugging Face cache, never into this repository. Missing weights or model runtime errors return a user-visible `503` model-unavailable response.

## API contract

- `POST /api/scan/validate` validates age and file metadata.
- `POST /api/scan/stage` decodes the submitted raster in memory and reports dimensions; `stored` is always `false`.
- `POST /api/scan/analyze` validates the request, invokes the local X-ray model, validates the returned report, and returns structured JSON.
- `POST /api/chat` receives the current report, short client-owned history, and question, then invokes the local chat model.
- `POST /api/export/pdf` validates the report and generates a PDF in memory from report data. It never calls a model or writes a file.

The canonical report schema is defined in `apps/api/analyzer/schemas.py` and mirrored by `apps/web/src/lib/xray.ts`. It includes scan information, plain-language explanation, findings, impression, recommendations, confidence, uncertainty, model ID, and disclaimer.

## Configuration

Copy `.env.example` to an environment file for local use. Configure `HF_XRAY_MODEL_ID`, `HF_CHAT_MODEL_ID`, `HF_CACHE_DIR`, `HF_DEVICE`, `ATTUNE_WEB_ORIGIN`, and `NEXT_PUBLIC_API_URL`. No hosted-model credentials are required.

## Verification

```bash
uv run --project apps/api pytest apps/api/tests
npm run lint
npm run build
```

Run the API with `npm run dev:api` and the web app with `npm run dev`. The complete manual path is `/` → `Try Demo` → `X-ray Analyzer` → select an image or DICOM → enter an age → `Analyze active scan` → inspect report → ask chat question → `Export PDF`.

## Known limitations

The current DICOM parser intentionally supports explicit/implicit little-endian and explicit big-endian uncompressed monochrome pixel data only. It does not decode encapsulated JPEG/JPEG-LS/JPEG2000 transfer syntaxes. The X-ray model is not a clinical device and must not be used for diagnosis. PDF export does not embed the image; it exports the structured report.
