# Attune

## Scope
Bare-minimum demo scaffold. No inference, uploads, authentication, database, or fabricated analysis results yet.

## Routes
- `/`: deliberately crude landing page with one **Try Demo** CTA to `/app`.
- `/app`: service picker for Knee MRI, Brain MRI, and Anaemia Screening.
- `/app/[service]`: named placeholder for each service; unknown slugs return 404.

## Visual direction
The app should grow toward Vercel/shadcn/Motion aesthetics: Geist typography, neutral dark surfaces, subtle borders, generous spacing, clear hierarchy, and restrained motion. Keep the landing page simple until explicitly redesigned.

Fetch all reusable UI components through shadcn, SkiperUI, or shadcnblocks. Prefer shadcn primitives; use the other registries only when needed. Handwritten route composition, copy, and layout utilities are allowed; handwritten UI primitives are not. Keep generated components in `apps/web/src/components/ui` and use their theme tokens. Future motion must respect reduced-motion preferences.

## Architecture
- `apps/web`: Next.js App Router, TypeScript, Tailwind, npm workspace.
- `apps/web/src/lib/services.ts`: service names, descriptions, and route slugs.
- `apps/api`: independent uv project running FastAPI; `/health` is the only initial endpoint.
- Future vision/Vosk adapters belong in the API, never in the browser. Add model dependencies only when implementing a service. Add API routers and shared packages only when needed.

Service pages must state their current availability accurately. Add real loading/error/result states when inference is implemented.
