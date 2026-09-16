# Lab Report Explainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Lab Report Explainer service that analyzes one transient JPG, PNG, or PDF through Gemini or Groq and returns structured educational results.

**Architecture:** FastAPI validates and normalizes uploads, calls one selected multimodal provider, validates its structured response, and performs one eligible fallback. A Next.js client page validates the file before upload and renders the normalized response with existing and CLI-fetched shadcn components.

**Tech Stack:** FastAPI, Pydantic, PyMuPDF, Pillow, Google Gen AI SDK, Groq SDK, Next.js 16, React 19, TypeScript, pdfjs-dist, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-17-lab-report-explainer-design.md`

## Global Constraints

- Add `/app/lab-report-explainer`; keep Anaemia Screening unchanged.
- Accept JPEG, PNG, and PDF up to 10 MB and 10 PDF pages.
- Keep uploads request-scoped and never write them to disk.
- Use one multimodal request for extraction and explanation.
- Use only report-observable values, ranges, and flags; never add clinical ranges, diagnoses, emergency determinations, or treatment advice.
- Retry once with the alternate configured provider only for rate limits, timeouts, connection failures, and provider 5xx responses.
- Never expose provider secrets through API responses or browser code.

---

### Task 1: API contract, validation, providers, and endpoint

**Files:**
- Modify: `apps/api/pyproject.toml`
- Modify: `apps/api/main.py`
- Create: `apps/api/lab_reports.py`
- Create: `apps/api/test_lab_reports.py`
- Create: `apps/api/uv.lock`

**Interfaces:**
- Produces: `POST /lab-reports/analyze`, `GET /health`, `AnalysisResult`, `analyze_with_fallback(images)`.
- Consumes: `AI_PROVIDER`, `GEMINI_API_KEY`, and `GROQ_API_KEY` environment variables.

- [ ] **Step 1: Add API dependencies through uv**

Run:

```bash
cd apps/api && uv add google-genai groq pymupdf pillow pytest
```

- [ ] **Step 2: Write failing API tests**

Cover exact behaviors with `TestClient`: provider diagnostics hide keys, invalid type returns `400`, oversized upload returns `400`, PDF page limit returns `400`, malformed images return `400`, no provider returns `503`, transient primary failure invokes alternate once, invalid provider payload returns `422` without fallback, and a valid response preserves optional observable fields.

Use dependency injection through a provider map so tests replace network adapters with local callables:

```python
def test_schema_failure_does_not_fallback(monkeypatch):
    calls = []
    monkeypatch.setenv("GEMINI_API_KEY", "secret")
    monkeypatch.setenv("GROQ_API_KEY", "secret")
    monkeypatch.setattr(lab_reports, "provider_calls", {
        "gemini": lambda images: calls.append("gemini") or {"tests": [{"name": ""}]},
        "groq": lambda images: calls.append("groq") or valid_result(),
    })
    response = client.post("/lab-reports/analyze", files=jpeg_file())
    assert response.status_code == 422
    assert calls == ["gemini"]
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
uv run --project apps/api pytest apps/api/test_lab_reports.py -q
```

Expected: collection or import failure because `lab_reports` and endpoint do not exist.

- [ ] **Step 4: Implement minimal API**

Define strict Pydantic models for tests, flagged explanations, warnings, questions, and limits. Read at most `10 MB + 1` bytes. Validate image bytes with Pillow. Open PDFs from bytes with PyMuPDF, reject more than 10 pages, and render pages to PNG bytes in memory.

Provider adapters must request JSON matching `AnalysisResult`, use fixed multimodal model names, and map only transient SDK failures to `TransientProviderError`. Parse every provider response through `AnalysisResult.model_validate_json`. Reject empty test lists and explanations for unflagged values.

Fallback logic:

```python
def analyze_with_fallback(images: list[bytes]) -> AnalysisResult:
    configured = configured_providers()
    for index, name in enumerate(provider_order(configured)):
        try:
            return validate_provider_result(provider_calls[name](images))
        except TransientProviderError:
            if index + 1 == len(configured):
                raise ProvidersUnavailable
    raise ProvidersUnavailable
```

Update health output to:

```json
{"status":"ok","ai":{"primary":"gemini","configured":["gemini","groq"]}}
```

- [ ] **Step 5: Run API tests and verify GREEN**

Run:

```bash
uv run --project apps/api pytest apps/api/test_lab_reports.py -q
```

Expected: all tests pass with no warnings.

- [ ] **Step 6: Commit task**

```bash
git add apps/api
git commit -m "feat(api): analyze transient lab reports"
```

### Task 2: Service route and upload/result interface

**Files:**
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/src/lib/services.ts`
- Modify: `apps/web/src/app/app/[service]/page.tsx`
- Create: `apps/web/src/app/app/lab-report-explainer/page.tsx`
- Create: `apps/web/src/app/app/lab-report-explainer/lab-report-explainer.tsx`
- Create via CLI: `apps/web/src/components/ui/alert.tsx`
- Create via CLI: `apps/web/src/components/ui/progress.tsx`

**Interfaces:**
- Consumes: `POST ${NEXT_PUBLIC_API_URL}/lab-reports/analyze` multipart field `file` and normalized `AnalysisResult` JSON.
- Produces: client validation, request status, extraction table, flagged explanations, clinician questions, privacy copy, and fixed safety limits.

- [ ] **Step 1: Install web dependency and shadcn primitives**

Run:

```bash
npm install pdfjs-dist --workspace apps/web
cd apps/web && npx shadcn@latest add alert progress -y
```

- [ ] **Step 2: Write failing client validation check**

Export `validateFile(file, pdfPages)` from the client module and add a minimal Node-compatible test that asserts unsupported types, files over 10 MB, and PDFs over 10 pages fail while a small JPEG passes.

```ts
assert.equal(validateFile(new File(["x"], "report.jpg", { type: "image/jpeg" }), 1), null)
assert.match(validateFile(new File([new Uint8Array(10_485_761)], "report.jpg", { type: "image/jpeg" }), 1)!, /10 MB/)
```

- [ ] **Step 3: Run check and verify RED**

Run `npm run lint --workspace apps/web`.

Expected: import or export failure because lab report client module does not exist.

- [ ] **Step 4: Build minimal client route**

Add service metadata with slug `lab-report-explainer`. Keep dynamic placeholder behavior for existing services, but route the new static page to a focused client component.

Use native file input plus drag events, `pdfjs-dist` only to count pages, and `fetch` with `FormData`. Disable submit during analysis. Render status with `Progress`; render errors and privacy/safety copy with `Alert`; render content inside existing `Card`, `Badge`, and `Button` primitives. Use semantic table markup with mobile horizontal scrolling. Omit absent fields instead of printing placeholders.

Read API base URL from `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:8000` for local development.

- [ ] **Step 5: Run web checks and verify GREEN**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit `0` with no errors.

- [ ] **Step 6: Commit task**

```bash
git add apps/web package-lock.json
git commit -m "feat(web): add lab report explainer"
```

### Task 3: Full verification and contract audit

**Files:**
- Modify only files needed to fix verified failures.

**Interfaces:**
- Consumes: completed API and web tasks.
- Produces: verified feature matching design contract.

- [ ] **Step 1: Run full focused verification**

```bash
uv run --project apps/api pytest apps/api/test_lab_reports.py -q
npm run lint
npm run build
```

- [ ] **Step 2: Audit requirements**

Confirm source contains one analyze endpoint, no upload writes, no secret response values, one eligible fallback, no fallback after schema failures, unchanged Anaemia Screening service, and no model-authored emergency determination.

- [ ] **Step 3: Review final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended implementation changes remain.
