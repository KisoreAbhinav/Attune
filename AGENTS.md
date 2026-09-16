# Agent instructions

Read `design.md` before changing the app.

- Keep this monorepo minimal: `apps/web` and `apps/api`. Do not create empty architecture folders or speculative packages.
- Use npm for Node tooling and uv for Python. Commit the root `package-lock.json` and `apps/api/uv.lock`.
- Scaffold with official CLIs. Change manifests through `npm pkg`, `npm install`, and `uv add`; do not handwrite package manifests or replace generated configs unnecessarily.
- Never handwrite reusable UI components. Fetch them using the shadcn CLI or official SkiperUI/shadcnblocks registry commands. Run shadcn from `apps/web`. Route composition and app logic may be handwritten.
- Preserve the simple landing page and its **Try Demo** CTA. Follow `design.md` for the app's visual direction.
- Keep inference and future Vosk/model dependencies in FastAPI. Do not add fake predictions or imply placeholders perform analysis.
- Do not commit secrets, uploads, model weights, virtual environments, or build outputs.
- Verify web changes with `npm run lint` and `npm run build`. Verify API changes with a focused smoke check; add meaningful tests when behavior warrants them.
- Avoid extra documentation, custom abstractions, orchestration tools, and dependencies until needed.
