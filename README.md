# Ghost Writer

Ghost Writer is a Chrome extension that writes in your voice. Open it as a side panel on any page and it works in one of two modes:

- **Product Review** — the original mode. On an Amazon product page, add optional notes and it generates a Vine-style review from the page's title/bullets — checked against an AI detector and rewritten until the score is under 20%.
- **General Writer** — reads whatever page you have open, takes a free-text prompt ("write a thank-you email based on this," "summarize this into three bullet points," anything), and writes it in a voice you pick from a category (Formal, Casual, Academic, Creative, Narrative, Technical, or the same Review voice as the other mode) — run through the same AI-detection refine loop.

Both modes read the same rules, memory, and category-based writing samples, and save their output to disk.

The extension is the app. A small local Python server sits behind it (Chrome extensions can't run AI CLIs or call arbitrary APIs with a hidden key directly). Unlike v1, **you no longer start this server yourself** — a Chrome Native Messaging host launches it on demand the moment you open the side panel, and the server shuts itself down after a few minutes of inactivity. There's nothing to leave running in a terminal.

By default, generation runs through the local `agy` CLI (the Antigravity CLI — install it separately and make sure it's on your `PATH`). You can instead configure **OpenRouter**, **Groq**, or **your own local model** (Ollama, LM Studio, llama.cpp, vLLM — anything OpenAI-compatible) as the active provider in Settings. Whichever one is selected still uses your rules, memory, and writing samples the same way agy does, and if the selected provider fails, Ghost Writer automatically falls back to agy.

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

3. **Add writing samples** — see [Writing Samples & Categories](#writing-samples--categories) below. You can drop files directly into `workspace/sample/<category>/`, or (once the extension is loaded) upload/paste them from the Settings page instead.

4. **Run the setup script once per machine** (macOS or Linux):
   ```
   ./setup.sh
   ```
   This creates `.venv`, installs the pinned Python dependencies from `server/requirements.txt`, scaffolds `docs/RULES.MD`/`docs/MEMORY.MD` from the examples if they don't exist yet, creates the `workspace/` folders, and tells you whether `agy`/`claude`/`sops` are available. It's safe to re-run any time — e.g. after unzipping this repo onto a new machine, it rebuilds `.venv` automatically if it detects one built for a different OS.

5. **Load the extension.** In Chrome, go to `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `extension/` folder. Note the **ID** Chrome shows for it (the extension pins a fixed key in `manifest.json`, so this ID is deterministic and won't change on reload or across machines — expect `djollbmehcmhelbfnhhogookmleldfmc` unless you've regenerated the key).

6. **Install the native messaging host, once per machine:**
   ```
   ./setup.sh <extension-id-from-step-5>
   ```
   (or directly: `./native-host/install.sh <extension-id>`). This registers `native-host/host.py` with every Chromium-family browser it finds installed (Chrome, Chromium, Brave, Edge) on macOS or Linux, so it can auto-launch the local server. On Windows, use `native-host/install.ps1 <extension-id>` instead (best-effort — macOS/Linux are the primary targets).

7. **Use it.** Click the Ghost Writer toolbar icon to open the side panel on any page. Pick **Product Review** (on an Amazon product page) or **General Writer** (any page), fill in the notes/prompt, and click Generate. The first click of the session may take a couple seconds while the native host spins the server up — after that it's instant. If you leave the panel idle for 5+ minutes, the server exits on its own; the next click starts it again transparently.

Requires: Python 3, and either the `agy` CLI on your `PATH` or an API key / local model endpoint configured in Settings.

---

## Moving to another machine

To move this whole setup (rules, memory, writing samples, encrypted secrets included) to another computer — e.g. zip it up and copy it to a Fedora box:

```
./package.sh                 # writes ../Ghostwriter.zip, excluding .venv/.git/__pycache__
```

On the target machine:
```
unzip Ghostwriter.zip
cd Ghostwriter
./setup.sh                   # rebuilds .venv for that machine's OS/arch
./setup.sh <extension-id>    # after loading the extension there, installs the native host
```

`config/secrets.enc.yaml` travels with the zip (it's sops-encrypted, safe to send), but it only decrypts on a machine that also has your age key at `~/.config/sops/age/keys.txt` (or `SOPS_AGE_KEY_FILE`) — copy that separately if you want the OpenRouter/Groq defaults to work there too. It's optional either way: without it, just fill in Settings by hand.

---

## Choosing an AI Provider

Click the gear icon (top-right of the side panel) to open Settings. Pick one:

| Provider | What you need |
|---|---|
| **Agy only** (default) | Nothing — uses the local `agy` CLI. |
| **OpenRouter** | An [OpenRouter](https://openrouter.ai) API key and a model slug (e.g. `openai/gpt-4o-mini`). |
| **Groq** | A [Groq](https://groq.com) API key and a model slug (e.g. `llama-3.3-70b-versatile`). |
| **Local model** | An OpenAI-compatible chat-completions endpoint URL (e.g. `http://localhost:11434/v1/chat/completions` for [Ollama](https://ollama.com)) and a model name/tag. API key optional — only needed if your local server requires one. |

Only one provider is active at a time, and it's shared by both Product Review and General Writer modes. Whichever you pick, generation still goes through the same rules, memory, and writing samples as agy. If the selected provider's call fails for any reason (bad key, rate limit, network error, endpoint unreachable), Ghost Writer automatically retries with agy instead of failing outright. Settings are saved in the browser (`chrome.storage.local`) — API keys and endpoints never leave your machine except in requests to the provider you chose.

---

## Writing Samples & Categories

Ghost Writer replicates your voice from real writing samples, organized into categories under `workspace/sample/`:

```
workspace/sample/
├── Writing guide.md         <- root-level files: ALWAYS included in full, every mode/category
├── Writing_Style_Guide.md
├── review/                  <- used by Product Review mode
├── formal/
├── casual/
├── academic/
├── creative/
├── narrative/
└── technical/
```

Any file placed **directly** in `workspace/sample/` (not inside a category folder) is injected into every prompt regardless of mode or category — put your most important, cross-cutting style guidance there. Files inside a category folder are only used when that category is active: Product Review always uses `review/`; General Writer uses whichever category you pick from its dropdown.

**Managing samples from the Settings UI (recommended):** open Settings → Writing Samples, and for each category you can:
- Upload a `.txt` or `.md` file directly, or
- Paste text with a name and click Add Sample.

Either way, the server saves it as a `.md` file under the right `workspace/sample/<category>/` folder — no need to touch the filesystem by hand. Existing samples per category are listed with a Delete button.

**Managing samples by hand:** drop `.md`/`.txt` files straight into the relevant `workspace/sample/<category>/` folder — the more diverse, the better the voice match. This whole directory is gitignored (only `.gitkeep` placeholders are tracked, so a fresh clone still has the folder structure), so your samples stay local. To keep prompts from becoming huge, only up to ~60,000 characters of a category's samples are packed in per request (root-level files are always included in full on top of that budget).

---

## Server & Output

### The local server now starts and stops itself

You no longer need to double-click anything to use Ghost Writer day to day. Opening the side panel triggers a Chrome Native Messaging call (`native-host/host.py`) that checks whether the server is already up and launches it if not (`server/server.py --managed`). If the panel sits idle for 5 minutes (`IDLE_TIMEOUT_SECONDS` in `server.py`), the managed server exits on its own. The next time you open the panel, it's relaunched automatically — you'll never see a lingering `python` process from this project after you close Chrome or stop using the extension.

`start_server.command` still exists as a manual/dev fallback (e.g. if you want to watch server logs live in a terminal while developing) — running it starts the server WITHOUT the idle-shutdown behavior, exactly like v1. It's optional for normal use.

### workspace/review/ and workspace/writing/

Every generated **Product Review** is saved to `workspace/review/`, and every generated **General Writer** piece is saved to `workspace/writing/` — both as plain `.txt` files, named after the product title or your prompt respectively, in addition to being shown in the side panel. If a file with that name already exists, a new one is saved alongside it (`Name (2).txt`, etc.) rather than overwriting it.

---

## Customizing the Output

### docs/RULES.MD

Hard rules the AI must follow every single time, no exceptions. Think of it as your style contract. See `docs/RULES.MD.example` for a starting point — things like banning em dashes, enforcing plain text with no markdown formatting, or a target word count. Applies to both modes.

**How to edit:** copy the example to `docs/RULES.MD` (see Setup above) and edit freely. Changes take effect on the next generated request — this file is read live on every request.

### docs/MEMORY.MD

Persistent background context the AI carries into every request — describe yourself, your preferences, or anything it should always remember. Injected verbatim into every prompt, both modes. See `docs/MEMORY.MD.example` for a starting point.

---

## Architecture

```
Ghostwriter/
├── README.md
├── .gitignore
├── setup.sh                     <- one-shot install: venv, deps, config scaffolding, native host
├── package.sh                   <- zips the repo cleanly for moving to another machine
├── start_server.command         <- manual/dev fallback: start the server without idle-shutdown
├── extension/                   <- the app itself, loaded into Chrome
│   ├── manifest.json              <- pinned "key" (stable extension ID) + nativeMessaging permission
│   ├── background.js              <- opens the side panel, warms up the server via native messaging
│   ├── content.js                  <- Amazon-specific scraper (Product Review mode)
│   ├── generic_scrape.js           <- any-site page scraper, injected on demand (General Writer mode)
│   ├── sidebar.html / sidebar.css / sidebar.js     <- side panel UI: mode toggle, both flows
│   ├── settings.html / settings.css / settings.js  <- provider settings + writing-samples manager
│   └── icons/
├── native-host/                 <- Chrome Native Messaging host (auto start-on-demand)
│   ├── host.py                    <- spawned by Chrome; ensures the server is running, then exits on disconnect
│   ├── com.ghostwriter.host.json.template
│   ├── install.sh                  <- run once per machine (macOS/Linux, all Chromium-family browsers)
│   └── install.ps1                 <- best-effort Windows equivalent
├── server/                      <- local API server behind the extension
│   ├── server.py                   <- FastAPI app: /generate-review, /generate-writing, /samples, /health
│   ├── review_engine.py            <- prompt building, category-aware samples, provider calls, AI-detection scoring
│   └── requirements.txt            <- pinned Python deps, installed by setup.sh
├── docs/
│   ├── RULES.MD.example            <- copy to RULES.MD and edit (gitignored)
│   ├── MEMORY.MD.example           <- copy to MEMORY.MD and edit (gitignored)
│   ├── plan.md                      <- original v1 implementation plan (historical)
│   └── plan_v2_generalist.md       <- implementation plan for this generalist-writer/on-demand-server upgrade
└── workspace/
    ├── review/                    <- generated Product Review outputs land here (gitignored)
    ├── writing/                   <- generated General Writer outputs land here (gitignored)
    └── sample/                    <- your writing samples, organized by category (gitignored)
```

The extension talks to the local server over `http://localhost:8000`, whose CORS is locked to the extension's own origin (`chrome-extension://<the pinned ID>`) — no other website's script can call it. The server never talks back to the browser except in that one response.

---

## Troubleshooting

**"agy is not installed or not in PATH"**
Ghost Writer uses the Antigravity (`agy`) CLI as its default/fallback. Either install it and put it on your shell `PATH`, or configure OpenRouter/Groq/a local model in Settings instead.

**Side panel shows "Make sure the background server is running!"**
The native messaging host couldn't start the server. Check `chrome://extensions` → "Inspect views: service worker" under Ghost Writer for errors from `background.js`, and confirm you ran `native-host/install.sh <extension-id>` with the ID Chrome actually shows for the loaded extension. As a fallback, run `./start_server.command` manually and try again.

**Side panel doesn't open when clicking the toolbar icon**
Go to `chrome://extensions`, click "Inspect views: service worker" under Ghost Writer to check `background.js` for errors.

**Content script isn't picking up the product title/details (Product Review mode)**
Amazon page layouts vary. Open DevTools on the product page (F12) and check that `#productTitle` and `#feature-bullets` exist on that specific page.

**General Writer mode returns empty/short page text**
Some pages hide their real content behind heavy client-side rendering that hasn't finished by the time you click Generate — wait for the page to fully load, or paste the relevant text into the prompt box directly.

**Selected an API provider but output still seems to come from agy**
Check the side panel's status message after generating — a `provider_warning` shows up there if your selected provider was missing its API key/model/endpoint and Ghost Writer silently fell back.

**Uploaded/pasted a sample in Settings but it's not showing up**
Make sure the local server is reachable (open the side panel once to trigger the native host, or run `./start_server.command`) — the Settings page's sample manager needs `http://localhost:8000` to be up, same as the side panel does.

---

## Quick Reference Card

| Task | Action |
|------|--------|
| Set up dependencies (once per machine) | `./setup.sh` |
| Load/reload the extension | `chrome://extensions` → Load unpacked → `extension/` |
| Install the native host (once per machine) | `./setup.sh <extension-id>` or `./native-host/install.sh <extension-id>` |
| Move this setup to another machine | `./package.sh`, then unzip + `./setup.sh` there |
| Set up your rules/memory | `cp docs/RULES.MD.example docs/RULES.MD` (same for MEMORY.MD), then edit — `setup.sh` does this for you if missing |
| Add writing samples | Settings → Writing Samples, or drop files into `workspace/sample/<category>/` |
| Choose a provider | Gear icon in the side panel |
| Find finished Product Reviews | `workspace/review/` |
| Find finished General Writer output | `workspace/writing/` |
| Manually run the server (dev/debug) | `./start_server.command` |
