import os
import re
import subprocess
import requests

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
SAMPLE_CATEGORIES = ("formal", "casual", "academic", "creative", "narrative", "technical", "review")

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

def unique_review_path(product_title):
    base = sanitize_filename(product_title)
    candidate = os.path.join(REVIEW_DIR, f"{base}.txt")
    if not os.path.exists(candidate):
        return candidate
    index = 2
    while True:
        candidate = os.path.join(REVIEW_DIR, f"{base} ({index}).txt")
        if not os.path.exists(candidate):
            return candidate
        index += 1

def unique_writing_path(slug):
    base = sanitize_filename(slug)[:80].strip() or "untitled"
    candidate = os.path.join(WRITING_DIR, f"{base}.txt")
    if not os.path.exists(candidate):
        return candidate
    index = 2
    while True:
        candidate = os.path.join(WRITING_DIR, f"{base} ({index}).txt")
        if not os.path.exists(candidate):
            return candidate
        index += 1

def run_agy(prompt, model="gemini-3.7-flash", effort="high", timeout=300):
    """
    Call agy in print mode. Falls back to default model on recognition errors.
    Returns stripped stdout text.
    """
    cmd = [
        "agy",
        "--dangerously-skip-permissions",
        "--effort", effort,
        "--model", model,
        "-p", prompt,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    output = result.stdout.strip()

    # agy writes model-not-found errors to stdout with exit 0
    if "is not recognized as a known model" in output or "invalid model selection" in output:
        print(f"  [warn] model '{model}' not recognized, falling back to default")
        fallback = [
            "agy",
            "--dangerously-skip-permissions",
            "--effort", effort,
            "-p", prompt,
        ]
        result = subprocess.run(fallback, capture_output=True, text=True, timeout=timeout)
        output = result.stdout.strip()

    return output

def call_openrouter(prompt, api_key, model, timeout=300):
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    response = requests.post(url, headers=headers, json=payload, timeout=timeout)
    response.raise_for_status()
    data = response.json()
    if not data.get("choices"):
        raise RuntimeError(f"OpenRouter API returned no choices: {data}")
    content = data["choices"][0]["message"]["content"]
    if not content:
        raise RuntimeError(f"OpenRouter API returned empty content: {data}")
    return content.strip()

def call_groq(prompt, api_key, model, timeout=300):
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    response = requests.post(url, headers=headers, json=payload, timeout=timeout)
    response.raise_for_status()
    data = response.json()
    if not data.get("choices"):
        raise RuntimeError(f"Groq API returned no choices: {data}")
    content = data["choices"][0]["message"]["content"]
    if not content:
        raise RuntimeError(f"Groq API returned empty content: {data}")
    return content.strip()

def call_local(prompt, endpoint, model, api_key="", timeout=300):
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
    }
    response = requests.post(endpoint, headers=headers, json=payload, timeout=timeout)
    response.raise_for_status()
    data = response.json()
    if not data.get("choices"):
        raise RuntimeError(f"Local model API returned no choices: {data}")
    content = data["choices"][0]["message"]["content"]
    if not content:
        raise RuntimeError(f"Local model API returned empty content: {data}")
    return content.strip()

def is_external_provider(provider):
    return provider in ("openrouter", "groq", "local")

def provider_configured(provider, api_key, model, endpoint=""):
    if provider in ("openrouter", "groq"):
        return bool(api_key) and bool(model)
    if provider == "local":
        return bool(endpoint) and bool(model)
    return False

def generate_review_text(prompt, provider, api_key, model, endpoint=""):
    if provider_configured(provider, api_key, model, endpoint):
        try:
            if provider == "openrouter":
                return call_openrouter(prompt, api_key, model)
            if provider == "groq":
                return call_groq(prompt, api_key, model)
            return call_local(prompt, endpoint, model, api_key)
        except Exception as exc:
            print(f"  [warn] {provider} call failed ({exc}), falling back to agy")
    return run_agy(prompt)

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
        if provider_configured(provider, api_key, model, endpoint):
            if provider == "openrouter":
                response = call_openrouter(prompt, api_key, model)
            elif provider == "groq":
                response = call_groq(prompt, api_key, model)
            else:
                response = call_local(prompt, endpoint, model, api_key)
        else:
            response = run_agy(prompt, effort="low")   # fast/cheap call
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
    """Return the list of category folder names under workspace/sample/."""
    if not os.path.isdir(SAMPLE_DIR):
        return []
    return sorted(
        name for name in os.listdir(SAMPLE_DIR)
        if not name.startswith(".") and os.path.isdir(os.path.join(SAMPLE_DIR, name))
    )

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
