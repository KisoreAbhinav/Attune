# Lab Report Explainer Design

## Goal

Add Lab Report Explainer as a new Attune service. Users upload a JPG, PNG, or PDF lab report and receive extracted values plus plain-language explanations of lab-printed flags. The service provides educational information only. It does not diagnose conditions, recommend treatment, or retain files and results.

Anaemia Screening remains a separate existing service. The new service uses `/app/lab-report-explainer`.

## Scope

Version one has no authentication, history, persistence, clinician dashboard, clinical decision support, handwritten-note support, prescription support, radiology interpretation, or diagnosis-report interpretation.

Uploads are limited to 10 MB and 10 PDF pages. Supported media types are JPEG, PNG, and PDF.

## Web Application

The service picker adds a Lab Report Explainer card without changing existing services. The service page uses existing shadcn primitives and Attune's dark visual system.

The upload flow supports file selection and drag-and-drop. The browser validates file type, size, and PDF page count before upload. It shows idle, validating, analyzing, result, and recoverable-error states. A visible privacy note states that documents are processed only for the current request and are not retained.

The result view shows every observable test returned by the API: test name, value, unit, printed reference range, printed flag, confidence, warning, and source page when available. Missing or uncertain fields remain absent. Flagged results include a plain-language explanation, common explicitly non-exclusive reasons for variation, and questions for a clinician. Educational limits remain prominent.

Urgent-care wording appears only when the source report itself marks a value critical. Fixed generic safety copy may tell users to follow prominent report instructions or contact a clinician. The model must not determine that a result is an emergency.

## API

FastAPI exposes one public endpoint:

`POST /lab-reports/analyze`

The endpoint accepts one transient multipart upload. It validates the media type, byte size, image decodability, PDF validity, and PDF page count. PDF pages are rendered to images in memory so both AI providers receive equivalent normalized visual input. The endpoint makes one multimodal model request that performs extraction and explanation together.

The normalized response contains:

- extracted tests with observable values and printed metadata;
- warnings and confidence information;
- explanations only for source-reported flagged values;
- common non-exclusive variation reasons;
- questions users can take to a clinician;
- educational and safety limits.

The API owns no clinical reference ranges. Prompts and response validation prohibit invented values, ranges, flags, diagnoses, emergency determinations, and treatment advice.

## Provider Selection and Fallback

Two small provider adapters hide Gemini and Groq SDK details. `AI_PROVIDER=gemini|groq` selects the primary provider. `GEMINI_API_KEY` and `GROQ_API_KEY` are optional server-only variables.

The API retries once with the other configured provider only after a rate limit, timeout, connection failure, or provider 5xx response. It does not use fallback for malformed, schema-invalid, or unsafe model output. If no provider is configured, or all eligible providers are unavailable, the API returns a clear retry-later response without saving the upload.

`GET /health` reports status, selected primary provider, and configured provider names. It never returns secrets.

## Errors

- `400`: unsupported media type, malformed file, file larger than 10 MB, or PDF longer than 10 pages.
- `422`: valid report with no supported lab values, or malformed, unsafe, or schema-invalid model output.
- `429` or `503`: configured providers are temporarily unavailable.
- `503`: no provider is configured.

Errors use stable machine-readable codes and concise user-safe messages. Upload bytes remain request-scoped for every outcome.

## Verification

API tests cover upload validation, image and PDF normalization, structured response validation, fallback eligibility, single-fallback behavior, health diagnostics, and absence of file writes. Provider network boundaries may be mocked; validation and fallback code run normally.

Web checks cover client validation and result rendering. Required repository checks are `npm run lint`, `npm run build`, and focused API tests or smoke checks. Implementation follows test-driven development for new behavior.
