"""Resilient Gemini setup shared by all Snug agents.

- Automatic retries with backoff on 429/5xx (busy or temporarily unavailable model).
- If the primary model still fails, the agent retries once on SNUG_MODEL_FALLBACK (if set).
- If everything fails, the shopper gets a friendly message instead of a broken screen.
"""
from __future__ import annotations

import logging
import os

from google.adk.models.google_llm import Gemini
from google.adk.models.llm_response import LlmResponse
from google.genai import types

log = logging.getLogger("snug.llm")
RETRY = types.HttpRetryOptions(attempts=4, initial_delay=1.0, max_delay=8.0, exp_base=2.0,
                               http_status_codes=[408, 429, 500, 502, 503, 504])


def make_model(env_var: str = "SNUG_MODEL", default: str = "gemini-3.5-flash"):
    name = os.environ.get(env_var) or os.environ.get("SNUG_MODEL") or default
    if not name.startswith("gemini"):
        return name            # e.g. a test model registered in the ADK model registry
    return Gemini(model=name, retry_options=RETRY)


async def model_error_fallback(callback_context, llm_request, error: Exception):
    """on_model_error_callback: try the fallback model once, else answer politely."""
    log.warning("Model call failed (%s): %s", type(error).__name__, str(error)[:300])
    fallback = os.environ.get("SNUG_MODEL_FALLBACK")
    if fallback and fallback != llm_request.model:
        try:
            llm_request.model = fallback
            async for resp in Gemini(model=fallback, retry_options=RETRY).generate_content_async(llm_request, stream=False):
                return resp
        except Exception as e2:  # noqa: BLE001
            log.error("Fallback model %s failed too: %s", fallback, str(e2)[:300])
    return LlmResponse(content=types.Content(role="model", parts=[types.Part(
        text="Sorry, Snug's AI is very busy right now. Please try again in a few seconds. "
             "Your fit verdict on the scan screen still works.")]))
