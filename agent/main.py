"""Snug server: ADK agent API + small store API + the Snug web app, in one Cloud Run service.

Local:   python main.py            -> http://localhost:8080/app/   (ADK dev UI at /dev-ui/ if SNUG_DEV_UI=1)
Cloud:   see README (gcloud run deploy --source .)
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

import mimetypes  # noqa: E402

import uvicorn  # noqa: E402

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/manifest+json", ".webmanifest")
from fastapi import HTTPException  # noqa: E402
from fastapi.responses import RedirectResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from google.adk.cli.fast_api import get_fast_api_app  # noqa: E402

from typing import Literal, Optional  # noqa: E402

from pydantic import BaseModel, Field  # noqa: E402

from snug_core import insights  # noqa: E402
from snug_core.db import PROFILES, STORES, get_db  # noqa: E402

origins = [o.strip() for o in os.environ.get("SNUG_ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
# allow the Cloud Shell web preview and Cloud Run URLs
origins += [r"regex:https://.*\.cloudshell\.dev", r"regex:https://.*\.run\.app"]

app = get_fast_api_app(
    agents_dir=str(ROOT / "apps"),
    allow_origins=origins,
    web=os.environ.get("SNUG_DEV_UI", "0") == "1",
)


# ---------- protection for a public demo: simple per-IP rate limit on AI calls ----------
import time as _time  # noqa: E402
from collections import defaultdict, deque  # noqa: E402

from fastapi import Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

LIMITS = {"/run_sse": int(os.environ.get("SNUG_AI_PER_MIN", "20")), "/run": int(os.environ.get("SNUG_AI_PER_MIN", "20")),
          "/api/events": 120, "/api/welcome-email": 5}
_hits: dict = defaultdict(deque)
STARTED = _time.time()


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    limit = LIMITS.get(request.url.path) if request.method == "POST" else None
    if limit:
        ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
        q, now = _hits[(ip, request.url.path)], _time.time()
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= limit:
            return JSONResponse({"detail": "Too many requests. Please wait a few seconds and try again."}, status_code=429)
        q.append(now)
    return await call_next(request)


# ---------- no stale app after a deploy ----------
# App files (HTML/JS/CSS/JSON) must be re-checked with the server on every load ("no-cache" = revalidate via ETag,
# so unchanged files still load fast). Only the large, versioned MediaPipe model files may be cached.
@app.middleware("http")
async def cache_headers(request: Request, call_next):
    resp = await call_next(request)
    path = request.url.path
    if path.startswith("/app/"):
        if "/vendor/mediapipe/" in path:
            resp.headers["Cache-Control"] = "public, max-age=604800"
        else:
            resp.headers["Cache-Control"] = "no-cache, must-revalidate"
    elif path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/api/status")
def status():
    """Quick health/status for monitoring and evaluators (no secrets)."""
    return {"ok": True, "uptime_s": round(_time.time() - STARTED), "backend": os.environ.get("SNUG_BACKEND", "local"),
            "model": os.environ.get("SNUG_MODEL"), "fallback_model": os.environ.get("SNUG_MODEL_FALLBACK"),
            "garments": len(get_db().all_garments())}


# ---------- small store API used by the web app (staff screen, catalogue panel) ----------
@app.get("/api/config")
def config():
    return {"stores": STORES, "profiles": PROFILES, "default_store": "BLR-07",
            "backend": os.environ.get("SNUG_BACKEND", "local")}


GARMENT_FIELDS = ("style_id", "name", "brand", "gender", "category", "fit_type", "fabric", "stretch_pct",
                  "price_inr", "colour", "occasions", "tags", "sizes", "gtins", "status")


@app.get("/api/garments")
def garments():
    """Full garment specs (no stock). The phone downloads these and runs the fit engine locally."""
    return [{k: g.get(k) for k in GARMENT_FIELDS} for g in get_db().list_garments()]


@app.get("/api/garments/by-gtin/{gtin}")
def garment_by_gtin(gtin: str):
    """Barcode lookup: returns the garment and the size printed on the scanned tag. Never receives body data."""
    g, size = get_db().get_by_gtin(gtin.strip())
    if not g:
        raise HTTPException(404, "Unknown barcode")
    return {"scanned_size": size, "garment": {k: g.get(k) for k in GARMENT_FIELDS}}


@app.get("/api/catalogue")
def catalogue():
    return [{k: g.get(k) for k in ("style_id", "name", "brand", "category", "fit_type", "price_inr",
                                   "status", "source", "sizes")} for g in get_db().all_garments()]


@app.get("/api/stores/{store_id}/tasks")
def tasks(store_id: str):
    return get_db().list_tasks(store_id)


@app.post("/api/stores/{store_id}/tasks/{task_id}/done")
def task_done(store_id: str, task_id: str):
    if not get_db().update_task(store_id, task_id, {"status": "done"}):
        raise HTTPException(404, "task not found")
    return {"status": "done"}


@app.get("/api/stores/{store_id}/holds")
def holds(store_id: str):
    return get_db().list_holds(store_id)


class ScanEvent(BaseModel):
    """Anonymous app event. Only these fields are accepted, so body data can never be stored."""
    type: Literal["scan", "accuracy_check"]
    store_id: str = Field(max_length=20)
    style_id: Optional[str] = Field(default=None, max_length=20)
    scanned_size: Optional[str] = Field(default=None, max_length=6)
    recommended_size: Optional[str] = Field(default=None, max_length=6)
    verdict: Optional[str] = Field(default=None, max_length=20)
    error_pct: Optional[float] = None


@app.post("/api/events")
def add_event(ev: ScanEvent):
    get_db().add_event(ev.model_dump(exclude_none=True))
    return {"ok": True}


class WelcomeReq(BaseModel):
    id_token: str = Field(max_length=4096)
    name: Optional[str] = Field(default=None, max_length=60)


_welcomed: set = set()


@app.post("/api/welcome-email")
def welcome_email(req: WelcomeReq):
    """Sends the 'Welcome to Snug' email to a just-created account. The Firebase ID token proves who is
    asking, and the email only ever goes to that account's own address, once."""
    from snug_core import mailer
    if not mailer.configured():
        raise HTTPException(503, "Welcome email is not configured on this server")
    from google.auth.transport import requests as greq
    from google.oauth2 import id_token
    try:
        claims = id_token.verify_firebase_token(req.id_token, greq.Request(), audience=os.environ.get("GOOGLE_CLOUD_PROJECT"))
    except Exception:
        raise HTTPException(401, "Invalid sign-in")
    email, uid = claims.get("email"), claims.get("sub")
    if not email or not uid:
        raise HTTPException(400, "This account has no email address")
    if uid in _welcomed:
        return {"ok": True, "already_sent": True}
    name = (claims.get("name") or req.name or email.split("@")[0]).strip()[:60]
    try:
        mailer.send(mailer.build_welcome(name, email))
    except Exception as e:  # noqa: BLE001
        print("welcome email failed:", type(e).__name__, e)
        raise HTTPException(502, "Could not send the email right now")
    _welcomed.add(uid)
    return {"ok": True}


@app.get("/api/stores/{store_id}/impact")
def store_impact(store_id: str, hours: float = 24):
    return insights.impact(store_id, hours)


@app.get("/api/insights/fit-signals")
def fit_signals(store_id: str = ""):
    return insights.fit_signals(store_id)


@app.get("/healthz")
def healthz():
    return {"ok": True}


app.mount("/app", StaticFiles(directory=str(ROOT / "web"), html=True), name="web")


@app.get("/", include_in_schema=False)
def home():
    return RedirectResponse("/app/judges.html")


# make "/" open the Snug app even when the ADK dev UI is enabled
app.router.routes.insert(0, app.router.routes.pop())


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
