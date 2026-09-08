import os

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import review_engine as gw


class GenerateReviewRequest(BaseModel):
    product_title: str
    product_details: str = ""
    user_comment: str = ""
    provider: str = "agy"
    api_key: str = ""
    model: str = ""
    endpoint: str = ""


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/generate-review")
def generate_review(request: GenerateReviewRequest):
    rules_text = gw.read_file(os.path.join(gw.DOCS_DIR, "RULES.MD"))
    memory_text = gw.read_file(os.path.join(gw.DOCS_DIR, "MEMORY.MD"))

    context_block = gw.build_context(rules_text, memory_text)

    if gw.provider_configured(request.provider, request.api_key, request.model, request.endpoint):
        samples_text = gw.read_samples()
    else:
        samples_text = f"(read the writing sample files in {gw.SAMPLE_DIR})"

    provider_warning = None
    if gw.is_external_provider(request.provider) and not gw.provider_configured(
        request.provider, request.api_key, request.model, request.endpoint
    ):
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

    review_text = gw.generate_review_text(prompt, request.provider, request.api_key, request.model, request.endpoint)
    if review_text == "":
        raise HTTPException(status_code=502, detail="No output from agy")

    score = gw.ai_score(review_text, request.provider, request.api_key, request.model, request.endpoint)

    attempts = 0
    while score >= gw.AI_SCORE_TARGET and attempts < gw.MAX_REFINE_ATTEMPTS:
        review_text = gw.generate_review_text(
            gw.build_refine_prompt(review_text, score, context_block),
            request.provider, request.api_key, request.model, request.endpoint,
        )
        score = gw.ai_score(review_text, request.provider, request.api_key, request.model, request.endpoint)
        attempts += 1

    out_path = gw.unique_review_path(request.product_title)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(review_text)

    return {"review": review_text, "ai_score": score, "provider_warning": provider_warning}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
