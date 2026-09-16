import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from lab_reports import configured_providers, primary_provider, router as lab_reports_router

app = FastAPI(title="Attune API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("WEB_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.include_router(lab_reports_router)


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "ai": {"primary": primary_provider(), "configured": configured_providers()},
    }
