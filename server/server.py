import argparse
import os
import threading
import time

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import review_engine as gw

# Phase 2: idle self-shutdown. `last_activity` is updated when an HTTP
# request finishes (not when it starts — see `active_requests` below).
# When the server is launched with `--managed` (i.e. spawned on-demand by
# native-host/host.py), a background thread watches this timestamp and
# exits the process once it's been idle longer than IDLE_TIMEOUT_SECONDS.
# When launched manually (no --managed flag, e.g. via start_server.command),
# the watcher thread is never started, so the server behaves exactly as it
# always has and never self-exits.
#
# `active_requests` guards against the watchdog killing the process mid
# request: /generate-review's refine loop can chain up to ~12 sequential
# `agy` subprocess calls and comfortably exceed IDLE_TIMEOUT_SECONDS on its
# own, so "idle" must mean "no in-flight requests", not just "stale
# last_activity timestamp".
IDLE_TIMEOUT_SECONDS = 300
last_activity = time.time()
active_requests = 0
active_requests_lock = threading.Lock()


class GenerateReviewRequest(BaseModel):
    product_title: str
    product_details: str = ""
    user_comment: str = ""
    provider: str = "agy"
    api_key: str = ""
    model: str = ""
    endpoint: str = ""


class GenerateWritingRequest(BaseModel):
    page_title: str = ""
    page_text: str = ""
    user_prompt: str = ""
    category: str = ""
    provider: str = "agy"
    api_key: str = ""
    model: str = ""
    endpoint: str = ""


class SampleWriteRequest(BaseModel):
    category: str
    filename: str
    content: str


class SampleDeleteRequest(BaseModel):
    category: str
    filename: str


app = FastAPI()

# Locked to the extension's fixed ID (see extension/manifest.json's "key"
# field, which pins this ID across reloads) now that /samples accepts
# arbitrary file writes/deletes and /generate-writing can be pointed at
# arbitrary API keys — previously allow_origins=["*"] let any webpage's JS
# hit localhost:8000 directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["chrome-extension://djollbmehcmhelbfnhhogookmleldfmc"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def track_activity(request, call_next):
    global last_activity, active_requests
    with active_requests_lock:
        active_requests += 1
    try:
        return await call_next(request)
    finally:
        with active_requests_lock:
            active_requests -= 1
        last_activity = time.time()


@app.post("/generate-review")
def generate_review(request: GenerateReviewRequest):
    rules_text = gw.read_file(os.path.join(gw.DOCS_DIR, "RULES.MD"))
    memory_text = gw.read_file(os.path.join(gw.DOCS_DIR, "MEMORY.MD"))

    context_block = gw.build_context(rules_text, memory_text)

    api_key, model, endpoint = gw.resolve_credentials(request.provider, request.api_key, request.model, request.endpoint)

    if gw.provider_configured(request.provider, api_key, model, endpoint):
        samples_text = gw.read_samples("review")
    else:
        samples_text = f"(read the writing sample files in {gw.SAMPLE_DIR})"

    provider_warning = None
    if gw.is_external_provider(request.provider) and not gw.provider_configured(request.provider, api_key, model, endpoint):
        if request.provider == "local":
            provider_warning = "local model selected but endpoint/model not configured — used agy instead."
        else:
            provider_warning = (
                f"{request.provider} selected but API key/model not configured — used agy instead."
            )

    prompt = gw.build_text_prompt(
        request.product_title,
        request.product_details,
        request.user_comment,
        context_block,
        samples_text,
    )

    try:
        review_text = gw.generate_review_text(prompt, request.provider, api_key, model, endpoint)
        if review_text == "":
            raise HTTPException(status_code=502, detail="No output from agy")

        score = gw.ai_score(review_text, request.provider, api_key, model, endpoint)

        attempts = 0
        while score >= gw.AI_SCORE_TARGET and attempts < gw.MAX_REFINE_ATTEMPTS:
            review_text = gw.generate_review_text(
                gw.build_refine_prompt(review_text, score, context_block),
                request.provider, api_key, model, endpoint,
            )
            score = gw.ai_score(review_text, request.provider, api_key, model, endpoint)
            attempts += 1
    except gw.ProviderCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    out_path = gw.unique_review_path(request.product_title)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(review_text)

    return {"review": review_text, "ai_score": score, "provider_warning": provider_warning}


@app.post("/generate-writing")
def generate_writing(request: GenerateWritingRequest):
    rules_text = gw.read_file(os.path.join(gw.DOCS_DIR, "RULES.MD"))
    memory_text = gw.read_file(os.path.join(gw.DOCS_DIR, "MEMORY.MD"))

    context_block = gw.build_context(rules_text, memory_text)

    api_key, model, endpoint = gw.resolve_credentials(request.provider, request.api_key, request.model, request.endpoint)

    if gw.provider_configured(request.provider, api_key, model, endpoint):
        samples_text = gw.read_samples(request.category)
    else:
        samples_text = f"(read the writing sample files in {gw.SAMPLE_DIR})"

    provider_warning = None
    if gw.is_external_provider(request.provider) and not gw.provider_configured(request.provider, api_key, model, endpoint):
        if request.provider == "local":
            provider_warning = "local model selected but endpoint/model not configured — used agy instead."
        else:
            provider_warning = (
                f"{request.provider} selected but API key/model not configured — used agy instead."
            )

    prompt = gw.build_generalist_prompt(
        request.page_title,
        request.page_text,
        request.user_prompt,
        request.category,
        context_block,
        samples_text,
    )

    try:
        writing_text = gw.generate_review_text(prompt, request.provider, api_key, model, endpoint)
        if writing_text == "":
            raise HTTPException(status_code=502, detail="No output from agy")

        score = gw.ai_score(writing_text, request.provider, api_key, model, endpoint)

        attempts = 0
        while score >= gw.AI_SCORE_TARGET and attempts < gw.MAX_REFINE_ATTEMPTS:
            writing_text = gw.generate_review_text(
                gw.build_refine_prompt(writing_text, score, context_block),
                request.provider, api_key, model, endpoint,
            )
            score = gw.ai_score(writing_text, request.provider, api_key, model, endpoint)
            attempts += 1
    except gw.ProviderCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    slug = request.user_prompt if request.user_prompt else request.page_title
    out_path = gw.unique_writing_path(slug)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(writing_text)

    return {"writing": writing_text, "ai_score": score, "provider_warning": provider_warning}


@app.get("/samples")
def get_samples():
    categories = {
        category: gw.list_samples(category)
        for category in gw.list_sample_categories()
    }
    return {"categories": categories}


@app.post("/samples")
def post_sample(request: SampleWriteRequest):
    if not gw.is_valid_category(request.category):
        raise HTTPException(status_code=400, detail=f"unknown category: {request.category}")
    filename = gw.save_sample(request.category, request.filename, request.content)
    return {"filename": filename}


@app.delete("/samples")
def delete_sample_endpoint(request: SampleDeleteRequest):
    if not gw.is_valid_category(request.category):
        raise HTTPException(status_code=400, detail=f"unknown category: {request.category}")
    deleted = gw.delete_sample(request.category, request.filename)
    if not deleted:
        raise HTTPException(status_code=404, detail="Sample not found")
    return {"deleted": True}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/provider-defaults")
def provider_defaults():
    """Tells the extension's quick-switcher which external providers have a
    usable default from config/secrets.enc.yaml, without ever exposing the
    actual key/model values."""
    return {
        "openrouter": bool(gw.SECRETS.get("openrouter_api_key")) and bool(gw.SECRETS.get("openrouter_model")),
        "groq": bool(gw.SECRETS.get("groq_api_key")) and bool(gw.SECRETS.get("groq_model")),
    }


def _idle_watchdog():
    """Background daemon thread (only started with --managed): exits the
    process once the server has been idle longer than IDLE_TIMEOUT_SECONDS.
    Uses os._exit(0) rather than a graceful uvicorn shutdown since this is a
    short-lived local dev tool with no connections/state that need cleanup.
    """
    while True:
        time.sleep(30)
        if active_requests > 0:
            continue
        if time.time() - last_activity > IDLE_TIMEOUT_SECONDS:
            os._exit(0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--managed",
        action="store_true",
        help="Run in managed mode (spawned by native-host/host.py): self-exit after "
        "IDLE_TIMEOUT_SECONDS of no HTTP activity. Omit this for manual/dev use "
        "(e.g. start_server.command) so the server never self-exits.",
    )
    args = parser.parse_args()

    if args.managed:
        watchdog = threading.Thread(target=_idle_watchdog, daemon=True)
        watchdog.start()

    uvicorn.run(app, host="127.0.0.1", port=8000)
