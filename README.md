# Ghost Writer

A Chrome extension (MV3, fully client-side — no server) that writes in your voice. It opens as a side panel bound to the tab you clicked it on and has two modes:

- **Product Review** — on an Amazon product page, generates a Vine-style review from the page's title/bullets plus optional notes.
- **General Writer** — reads the current page, takes a free-text prompt, and writes it in the voice of a category you pick (Formal, Casual, Academic, Creative, Narrative, Technical, Review, Cover Letter). On a job posting it auto-selects Cover Letter, detects the employer, and offers **Export as PDF** with your Profile as the letterhead.

Every draft is scored for AI-sounding text and rewritten (up to 5 times) until the score is under 20. Generation and scoring can use different providers (e.g. cloud API to write, a local model to score).

## Install

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select `extension/`. (`./reload-extension.sh` relaunches Chrome with it loaded during development.)
2. Click the toolbar icon to open the panel, then the gear icon for **Settings**.

## Settings

- **Provider** — pick *Generate with* and *Score with* (OpenRouter, Groq, or any OpenAI-compatible local endpoint such as Ollama), and fill in the key/endpoint and model for each. Errors from a provider are shown as-is; there is no silent fallback.
- **Profile** — sender details for exported cover-letter PDFs.
- **Rules & Memory** — Rules (hard constraints), Memory (context), About Me (background), injected into every prompt.
- **Writing Samples** — upload or paste samples per category. The **Always Included** panel's samples are prepended to every category.
- **Import Backup** — load a JSON file `{rulesText, memoryText, personalizationText, samples: {category: {filename: text}}}` to restore or migrate data in one step.

Everything is stored in `chrome.storage.local`; API keys only leave the browser in requests to the provider you chose.

## Development

- `python3 tests/browser/smoke_test.py` — self-hosted Playwright suite (`pip install -r tests/requirements-dev.txt && playwright install chromium`).
- `./package.sh` — zip the source for another machine.
- See `AGENTS.md` for architecture and conventions.
