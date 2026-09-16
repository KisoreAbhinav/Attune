# Attune
Image Analysis for X-Ray, MRI Scans, Symptoms and Early Disease Detection.

```text
apps/web/     Next.js + Tailwind + shadcn/ui (npm workspace)
apps/api/     FastAPI (uv project)
design.md     Product and visual direction
AGENTS.md     Agent development rules
```

Install with `npm ci` and `uv sync --project apps/api`.

Run in separate terminals from the repository root:

```sh
npm run dev
npm run dev:api
```

Web: http://localhost:3000 → **Try Demo** → service picker → service preview.
API: http://127.0.0.1:8000/health; API docs: http://127.0.0.1:8000/docs.

Verify with `npm run lint` and `npm run build`.
Add UI components with `cd apps/web && npx shadcn@latest add <component>`.
Add Python dependencies with `uv add --project apps/api <package>`.

Models, uploads, and inference are not implemented yet.
