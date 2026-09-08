# Ghost Writer

Ghost Writer is a Chrome extension that helps you write Amazon Vine product reviews in your own voice. Open it as a side panel on any Amazon product page, add optional notes, and it generates a review from the page's title/bullets — checked against an AI detector and rewritten until the score is under 20%.

The extension is the app. A small local Python server sits behind it (Chrome extensions can't run AI CLIs or call arbitrary APIs with a hidden key directly) — start it once, then everything happens from the side panel.

By default, review generation runs through the local [`agy`](https://github.com/antigravity-ai) CLI. You can instead configure **OpenRouter**, **Groq**, or **your own local model** (Ollama, LM Studio, llama.cpp, vLLM — anything OpenAI-compatible) as the active provider in Settings. Whichever one is selected still uses your rules, memory, and writing samples the same way agy does, and if the selected provider fails, Ghost Writer automatically falls back to agy.

---

## Setup

1. **Clone the repo.**
   ```
   git clone https://github.com/DanielNg520/Ghostwritter.git
   cd Ghostwritter
   ```

2. **Add your writing rules and voice.** Copy the two example files and edit them:
   ```
   cp docs/RULES.MD.example docs/RULES.MD
   cp docs/MEMORY.MD.example docs/MEMORY.MD
   ```
   - `docs/RULES.MD` — hard rules the AI must follow every time (formatting, length, tone constraints). See [Customizing the Output](#customizing-the-output) below.
   - `docs/MEMORY.MD` — persistent background context injected into every prompt (who you are, how you write, what to avoid).
   - Both are gitignored, so your personal versions never get committed.

3. **Add writing samples.** Drop `.md`/`.txt` files of your own real writing into `workspace/sample/` — the more diverse, the better the voice match. This folder is gitignored too (only a `.gitkeep` placeholder is tracked), so your samples stay local. One filename is special: if a file named exactly `Writing guide.md` exists in that folder, it's always included in full, first, regardless of size — put your most important style guidance there if you have one.

4. **Start the local server.**
   ```
   ./start_server.command
   ```
   First run creates a `.venv` and installs `fastapi`/`uvicorn`/`requests`. Leave the terminal window open — it's running at `http://127.0.0.1:8000`.

5. **Load the extension.** In Chrome, go to `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder.

6. **Use it.** Navigate to any Amazon product page, click the Ghost Writer toolbar icon to open the side panel, optionally type notes, and click **Generate Review**.

Requires: Python 3, Node not required (the batch/screenshot tooling this project started as has been removed — see [Architecture](#architecture)), and either the `agy` CLI on your `PATH` or an API key / local model endpoint configured in Settings.

---

## Choosing an AI Provider

Click the gear icon (top-right of the side panel) to open Settings. Pick one:

| Provider | What you need |
|---|---|
| **Agy only** (default) | Nothing — uses the local `agy` CLI. |
| **OpenRouter** | An [OpenRouter](https://openrouter.ai) API key and a model slug (e.g. `openai/gpt-4o-mini`). |
| **Groq** | A [Groq](https://groq.com) API key and a model slug (e.g. `llama-3.3-70b-versatile`). |
| **Local model** | An OpenAI-compatible chat-completions endpoint URL (e.g. `http://localhost:11434/v1/chat/completions` for [Ollama](https://ollama.com)) and a model name/tag. API key optional — only needed if your local server requires one. |

Only one provider is active at a time. Whichever you pick, the review still goes through the same rules, memory, and writing samples as agy. If the selected provider's call fails for any reason (bad key, rate limit, network error, endpoint unreachable), Ghost Writer automatically retries with agy instead of failing outright. Settings are saved in the browser (`chrome.storage.local`) — API keys and endpoints never leave your machine except in requests to the provider you chose.

---

## Customizing the Output

### docs/RULES.MD

Hard rules the AI must follow every single time, no exceptions. Think of it as your style contract. See `docs/RULES.MD.example` for a starting point — things like banning em dashes, enforcing plain text with no markdown formatting, or a target word count.

**How to edit:** copy the example to `docs/RULES.MD` (see Setup above) and edit freely. Changes take effect on the next generated review — this file is read live on every request.

### docs/MEMORY.MD

Persistent background context the AI carries into every review — describe yourself, your preferences, or anything it should always remember. Injected verbatim into every prompt. See `docs/MEMORY.MD.example` for a starting point.

### workspace/sample/

Contains examples of your real writing. The AI reads these every time it writes a review to calibrate your voice, vocabulary, and rhythm. Add `.md`/`.txt` files any time — more diverse samples improve voice replication. To keep prompts from becoming huge, only up to ~60,000 characters of samples are inlined per request (the `Writing guide.md` file, if present, is always included in full regardless of this limit; other files are packed in until the limit is hit).

### workspace/review/

Every generated review is saved here automatically as a plain `.txt` file, named after the product title, in addition to being shown in the side panel. If a file with that name already exists, a new one is saved alongside it (`Product Name (2).txt`, etc.) rather than overwriting it.

---

## Architecture

```
Ghostwritter/
├── README.md
├── .gitignore
├── start_server.command      <- double-click: start the local API server
├── extension/                <- the app itself, loaded into Chrome
│   ├── manifest.json
│   ├── background.js         <- opens the side panel on toolbar click
│   ├── content.js             <- scrapes product title/details from the page
│   ├── sidebar.html / sidebar.css / sidebar.js     <- side panel UI + logic
│   ├── settings.html / settings.css / settings.js  <- provider settings (options page)
│   └── icons/
├── server/                   <- local API server behind the extension
│   ├── server.py              <- FastAPI app, POST /generate-review
│   └── review_engine.py       <- prompt building, agy/OpenRouter/Groq/local calls, AI-detection scoring
├── docs/
│   ├── RULES.MD.example        <- copy to RULES.MD and edit (gitignored)
│   ├── MEMORY.MD.example       <- copy to MEMORY.MD and edit (gitignored)
│   └── plan.md                 <- original implementation plan (historical)
└── workspace/
    ├── review/                  <- generated reviews land here (gitignored)
    └── sample/                   <- your writing samples go here (gitignored)
```

The extension talks to the local server over `http://localhost:8000`; the server never talks back to the browser except in that one response. Nothing here batch-processes screenshots anymore — an earlier version of this project scraped Amazon Vine tabs with Playwright, but the extension's on-demand, per-page workflow replaced it entirely.

---

## Troubleshooting

**"agy is not installed or not in PATH"**
Ghost Writer uses the Antigravity (`agy`) CLI as its default/fallback. Either install it and put it on your shell `PATH`, or configure OpenRouter/Groq/a local model in Settings instead.

**Side panel shows "Make sure the background server is running!"**
`start_server.command` isn't running, or was closed. Re-launch it.

**Side panel doesn't open when clicking the toolbar icon**
Go to `chrome://extensions`, click "Inspect views: service worker" under Ghost Writer to check `background.js` for errors.

**Content script isn't picking up the product title/details**
Amazon page layouts vary. Open DevTools on the product page (F12) and check that `#productTitle` and `#feature-bullets` exist on that specific page.

**Selected an API provider but reviews still seem to come from agy**
Check the side panel's status message after generating — a `provider_warning` shows up there if your selected provider was missing its API key/model/endpoint and Ghost Writer silently fell back.

---

## Quick Reference Card

| Task | Action |
|------|--------|
| Start the server | `./start_server.command` |
| Load/reload the extension | `chrome://extensions` → Load unpacked → `extension/` |
| Set up your rules/memory | `cp docs/RULES.MD.example docs/RULES.MD` (same for MEMORY.MD), then edit |
| Add writing samples | Drop files into `workspace/sample/` |
| Choose a provider | Gear icon in the side panel |
| Find finished reviews | `workspace/review/` |
