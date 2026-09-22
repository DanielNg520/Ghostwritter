import json
import os
import re
import subprocess
import requests

import secrets_loader
from cli_path import resolve_cli_path

SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR      = os.path.dirname(SCRIPT_DIR)
DOCS_DIR      = os.path.join(ROOT_DIR, "docs")
WORKSPACE_DIR = os.path.join(ROOT_DIR, "workspace")
REVIEW_DIR    = os.path.join(WORKSPACE_DIR, "review")
WRITING_DIR   = os.path.join(WORKSPACE_DIR, "writing")
SAMPLE_DIR    = os.path.join(WORKSPACE_DIR, "sample")

os.makedirs(REVIEW_DIR, exist_ok=True)
os.makedirs(WRITING_DIR, exist_ok=True)

MAX_REFINE_ATTEMPTS = 5
AI_SCORE_TARGET     = 20
SAMPLES_CHAR_LIMIT = 60000
SAMPLE_CATEGORIES = ("formal", "casual", "academic", "creative", "narrative", "technical", "review", "cover_letter")

# Loaded once at import time (decrypts config/secrets.enc.yaml via sops) so
# OpenRouter/Groq credentials have a default even when the extension's own
# Settings page hasn't been filled in. {} if the file/sops/age key isn't
# available — see resolve_credentials(), which treats that as "no default".
SECRETS = secrets_loader.load_secrets()

def is_valid_category(category):
    """Whitelist check — categories map directly to directory names on disk."""
    return category in SAMPLE_CATEGORIES

# ── Helpers ──────────────────────────────────────────────────────────────────

def read_file(filepath):
    """Return file contents, or empty string if file is missing or blank."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read().strip()
    except (FileNotFoundError, UnicodeDecodeError):
        return ""

def sanitize_filename(name):
    """Make a product title safe to use as a filename."""
    clean = re.sub(r'[/\\:*?"<>|]', ' ', name)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean[:180] if len(clean) > 180 else clean

def _unique_path(directory, base):
    """First non-colliding "<base>.txt" / "<base> (2).txt" / ... path in
    `directory`. Shared by unique_review_path()/unique_writing_path(),
    which only differ in which directory and how `base` gets computed."""
    candidate = os.path.join(directory, f"{base}.txt")
    if not os.path.exists(candidate):
        return candidate
    index = 2
    while True:
        candidate = os.path.join(directory, f"{base} ({index}).txt")
        if not os.path.exists(candidate):
            return candidate
        index += 1

def unique_review_path(product_title):
    return _unique_path(REVIEW_DIR, sanitize_filename(product_title))

def unique_writing_path(slug):
    base = sanitize_filename(slug)[:80].strip() or "untitled"
    return _unique_path(WRITING_DIR, base)

AGY_PATH = resolve_cli_path("agy")


def _parse_agy_json(stdout):
    """agy --output-format json always prints exactly one JSON object to
    stdout (even on error), keeping any tool-call/background-task chatter
    it produces while agentically working out of the captured text —
    unlike plain text mode, which interleaves that chatter with the actual
    answer. Returns None if stdout wasn't parseable JSON (unexpected agy
    version/output), so the caller can fall back to raw text."""
    try:
        return json.loads(stdout)
    except (json.JSONDecodeError, ValueError):
        return None

def run_agy(prompt, model="gemini-3.7-pro", effort="low", timeout=300):
    """
    Call agy in print mode. Falls back to default model on recognition errors.
    Returns just the final answer text, not agy's own tool-call/task chatter.
    """
    cmd = [
        AGY_PATH,
        "--dangerously-skip-permissions",
        "--effort", effort,
        "--model", model,
        "--output-format", "json",
        "-p", prompt,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    data = _parse_agy_json(result.stdout)
    error_text = (data or {}).get("error", "") + (data or {}).get("response", "")

    if data is None or "is not recognized as a known model" in error_text or "invalid model selection" in error_text:
        print(f"  [warn] model '{model}' not recognized, falling back to default")
        fallback = [
            AGY_PATH,
            "--dangerously-skip-permissions",
            "--effort", effort,
            "--output-format", "json",
            "-p", prompt,
        ]
        result = subprocess.run(fallback, capture_output=True, text=True, timeout=timeout)
        data = _parse_agy_json(result.stdout)

    if data is None:
        return result.stdout.strip()
    return data.get("response", "").strip()

CLAUDE_PATH = resolve_cli_path("claude")


def run_claude_code(prompt, timeout=300):
    """Call the local Claude Code CLI in headless print mode. Returns just
    the final answer text (not any tool-call chatter along the way) — same
    shape as run_agy()."""
    cmd = [CLAUDE_PATH, "--dangerously-skip-permissions", "--print", "--output-format", "json", "-p", prompt]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    try:
        data = json.loads(result.stdout)
    except (json.JSONDecodeError, ValueError):
        return result.stdout.strip()
    return str(data.get("result", "")).strip()

# Shared by call_openrouter()/call_groq()/call_local(): all three are the
# same OpenAI-compatible chat-completions shape, differing only in
# url/headers/error label.
def _call_chat_completions(url, headers, model, prompt, timeout, label):
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    response = requests.post(url, headers=headers, json=payload, timeout=timeout)
    response.raise_for_status()
    data = response.json()
    if not data.get("choices"):
        raise RuntimeError(f"{label} API returned no choices: {data}")
    content = data["choices"][0]["message"]["content"]
    if not content:
        raise RuntimeError(f"{label} API returned empty content: {data}")
    return content.strip()

def call_openrouter(prompt, api_key, model, timeout=300):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    return _call_chat_completions("https://openrouter.ai/api/v1/chat/completions", headers, model, prompt, timeout, "OpenRouter")

def call_groq(prompt, api_key, model, timeout=300):
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    return _call_chat_completions("https://api.groq.com/openai/v1/chat/completions", headers, model, prompt, timeout, "Groq")

def call_local(prompt, endpoint, model, api_key="", timeout=300):
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return _call_chat_completions(endpoint, headers, model, prompt, timeout, "Local model")

def is_external_provider(provider):
    return provider in ("openrouter", "groq", "local")

def provider_configured(provider, api_key, model, endpoint=""):
    if provider in ("openrouter", "groq"):
        return bool(api_key) and bool(model)
    if provider == "local":
        return bool(endpoint) and bool(model)
    return False

def resolve_credentials(provider, api_key, model, endpoint=""):
    """Fill in api_key/model from the sops-decrypted secrets file (SECRETS)
    when the extension's own Settings page left them blank — an explicit
    value from the extension always wins. agy/claude_code need no
    credentials and pass through unchanged."""
    if provider == "openrouter":
        api_key = api_key or SECRETS.get("openrouter_api_key", "")
        model = model or SECRETS.get("openrouter_model", "")
    elif provider == "groq":
        api_key = api_key or SECRETS.get("groq_api_key", "")
        model = model or SECRETS.get("groq_model", "")
    return api_key, model, endpoint

class ProviderCallError(Exception):
    """Raised when a configured external provider's API call itself fails
    (auth error, network error, bad response) — this does NOT fall back to
    agy silently; the caller (server.py) surfaces it as a real error."""

# Shared by generate_review_text()/ai_score(): both need to route a prompt
# to whichever backend `provider` names. agy_effort is None for the full
# generation path (run_agy()'s own default) and "low" for ai_score()'s
# cheap/fast default-agy call.
def _dispatch_to_provider(prompt, provider, api_key, model, endpoint, agy_effort=None):
    if provider == "claude_code":
        return run_claude_code(prompt)
    if provider in ("openrouter", "groq", "local") and provider_configured(provider, api_key, model, endpoint):
        try:
            if provider == "openrouter":
                return call_openrouter(prompt, api_key, model)
            if provider == "groq":
                return call_groq(prompt, api_key, model)
            return call_local(prompt, endpoint, model, api_key)
        except Exception as exc:
            raise ProviderCallError(f"{provider} call failed: {exc}") from exc
    # agy (the default), or an external provider left unconfigured — the
    # unconfigured case is surfaced separately as a provider_warning by the
    # caller, with agy as the documented fallback.
    return run_agy(prompt, effort=agy_effort) if agy_effort else run_agy(prompt)

def generate_review_text(prompt, provider, api_key, model, endpoint=""):
    return _dispatch_to_provider(prompt, provider, api_key, model, endpoint)

def ai_score(text, provider="agy", api_key="", model="", endpoint=""):
    """
    Ask agy to rate how AI-sounding a piece of text is (0=human, 100=AI).
    Returns an integer. Defaults to 100 on parse failure.
    """
    prompt = (
        "Rate the probability that the following text was written by an AI. "
        "Output ONLY a single integer from 0 (definitely human) to 100 (definitely AI). "
        "No explanation.\n\nText:\n" + text
    )
    try:
        response = _dispatch_to_provider(prompt, provider, api_key, model, endpoint, agy_effort="low")
    except Exception as exc:
        print(f"  [warn] ai_score failed ({exc}), skipping refinement for this review")
        return 0
    match = re.search(r'\b(\d{1,3})\b', response)
    return min(int(match.group(1)), 100) if match else 100

# ── Prompt builders ───────────────────────────────────────────────────────────

def build_context(rules_text, memory_text):
    parts = []
    if rules_text:
        parts.append(f"--- RULES (must follow) ---\n{rules_text}")
    if memory_text:
        parts.append(f"--- MEMORY (keep in mind) ---\n{memory_text}")
    return "\n\n".join(parts)

def read_samples(category=None):
    """
    Build the writing-samples block for a prompt.

    Root-level files directly in workspace/sample/ (e.g. "Writing guide.md")
    are always included in full first, regardless of category. If a
    category is given, files from workspace/sample/<category>/ are packed
    in next, subject to the same overall SAMPLES_CHAR_LIMIT budget.
    """
    if not os.path.isdir(SAMPLE_DIR):
        return ""
    samples = []
    total_len = 0
    omitted = False

    for name in sorted(os.listdir(SAMPLE_DIR)):
        if name.startswith("."):
            continue
        path = os.path.join(SAMPLE_DIR, name)
        if os.path.isfile(path):
            content = read_file(path)
            if content:
                entry = f"--- {name} ---\n{content}"
                samples.append(entry)
                total_len += len(entry)

    if category and is_valid_category(category):
        category_dir = os.path.join(SAMPLE_DIR, category)
        if os.path.isdir(category_dir):
            for name in sorted(os.listdir(category_dir)):
                if name.startswith("."):
                    continue
                path = os.path.join(category_dir, name)
                if os.path.isfile(path):
                    content = read_file(path)
                    if content:
                        entry = f"--- {category}/{name} ---\n{content}"
                        if total_len + len(entry) > SAMPLES_CHAR_LIMIT:
                            omitted = True
                            continue
                        samples.append(entry)
                        total_len += len(entry)

    if omitted:
        samples.append("[additional samples omitted for length]")
    return "\n\n".join(samples)

def list_sample_categories():
    """Return category folder names under workspace/sample/, in
    SAMPLE_CATEGORIES's declared order (any directory not listed there
    sorts alphabetically after) -- this is the single source of truth for
    category *order* too, not just membership, since the extension's
    category dropdown and sample panels both derive their list from this
    via GET /samples rather than keeping their own hardcoded order."""
    if not os.path.isdir(SAMPLE_DIR):
        return []
    existing = {
        name for name in os.listdir(SAMPLE_DIR)
        if not name.startswith(".") and os.path.isdir(os.path.join(SAMPLE_DIR, name))
    }
    ordered = [c for c in SAMPLE_CATEGORIES if c in existing]
    extra = sorted(existing - set(SAMPLE_CATEGORIES))
    return ordered + extra

def list_samples(category):
    """Return filenames (skipping dotfiles/.gitkeep) in a category folder."""
    category_dir = os.path.join(SAMPLE_DIR, category)
    if not os.path.isdir(category_dir):
        return []
    return sorted(
        name for name in os.listdir(category_dir)
        if not name.startswith(".") and os.path.isfile(os.path.join(category_dir, name))
    )

def save_sample(category, filename, content):
    """
    Save a writing sample under workspace/sample/<category>/, forcing a
    .md extension. If a file with the same (sanitized) name already exists,
    it is overwritten in place — re-uploading a sample to fix/replace it is
    a normal use case, so we don't append " (2)" here like review outputs do.
    """
    if not is_valid_category(category):
        raise ValueError(f"unknown sample category: {category!r}")

    category_dir = os.path.join(SAMPLE_DIR, category)
    os.makedirs(category_dir, exist_ok=True)

    base = sanitize_filename(os.path.splitext(filename)[0]) or "sample"
    final_name = f"{base}.md"
    path = os.path.join(category_dir, final_name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return final_name

def delete_sample(category, filename):
    """
    Delete a sample file under workspace/sample/<category>/. Guards against
    path traversal by rejecting filenames containing "/" or ".." and by
    verifying the resolved path stays inside the category directory.
    """
    if not is_valid_category(category):
        return False
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return False

    category_dir = os.path.abspath(os.path.join(SAMPLE_DIR, category))
    path = os.path.abspath(os.path.join(category_dir, filename))
    if os.path.dirname(path) != category_dir:
        return False

    if os.path.isfile(path):
        os.remove(path)
        return True
    return False

def build_text_prompt(product_title, product_details, user_comment, context_block, samples_text):
    if user_comment:
        strategy = (
            f"The author left these notes about {product_title}:\n\"{user_comment}\"\n"
            "Use them as the primary basis for the review."
        )
    else:
        strategy = (
            f"Search the internet for real customer reviews of '{product_title}'. "
            "If none are found, search for the product description instead. "
            "Base the review on that research."
        )

    return f"""You are a ghostwriter writing an Amazon Vine review.

Product title: {product_title}
Product details: {product_details if product_details else "(none provided)"}
No product image is available; use the product title and details above to identify what the product is.

{strategy}

Writing samples (replicate this author's voice, rhythm, and sentence structure):
{samples_text}

{context_block}

Output ONLY the finished review text. Nothing else."""

def build_generalist_prompt(page_title, page_text, user_prompt, category, context_block, samples_text):
    page_block = (
        f"Page title: {page_title if page_title else '(none provided)'}\n"
        f"Page text: {page_text if page_text else '(none provided)'}"
    )

    return f"""You are a ghostwriter helping someone write a piece of text.

The user currently has this page open in their browser (optional reference
material — use it only if it's relevant to the request below):
{page_block}

What the user wants written:
{user_prompt if user_prompt else "(no specific instructions provided — use the page content above as the basis for what to write)"}

Voice/category to write in: {category if category else "(none specified)"}

Writing samples (replicate this author's voice, rhythm, and sentence structure):
{samples_text}

{context_block}

Output ONLY the finished text. Nothing else."""

def build_refine_prompt(review_text, score, context_block):
    return f"""This review scored {score}% on an AI-detection scale (lower is more human).
Rewrite it to sound more natural and human. Do not change the core content.

{context_block}

Output ONLY the rewritten review text. Nothing else.

Original review:
{review_text}"""
