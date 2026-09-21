# Ghost Writer — AGENTS.md

Chrome extension (MV3) + local FastAPI server + native-messaging host. Personal
tool: writes Amazon Vine reviews and general-purpose text (cover letters,
essays, etc.) in the user's voice, using local CLIs (agy/claude_code) or
external providers (OpenRouter/Groq/local model) as the LLM backend.

Read this file first. Update it after every implementation change.

## Architecture

- **extension/** — MV3 extension, side-panel UI.
  - `background.js` — service worker. Opens the side panel on toolbar click,
    warms up the native host (which ensures the local server is running).
  - `content.js` — static content script, scoped to `*://*.amazon.com/*`
    (see `host_permissions`). Scrapes product title/bullets for Review mode.
  - `generic_scrape.js` — page scraper for General Writer mode. Injected via
    `chrome.scripting.executeScript` (needs only `activeTab`, not broad host
    permissions) so it works on any site. Detects known job boards/ATSes by
    hostname (LinkedIn, Handshake, Indeed, Greenhouse, Lever, Workday, etc.)
    and, on those, extracts just the job-description block (via a selector
    shortlist, falling back to a keyword-scored heuristic) instead of the
    whole page — returns `{ title, text, siteType: "job"|"general" }`.
  - `sidebar.js` / `sidebar.html` — the panel UI. Two modes: **Review**
    (Amazon) and **General Writer** (any page + free-form prompt + a style
    "category" that pulls matching writing samples). On panel open,
    `detectJobPageAndConfigure()` best-effort-scripts the active tab; if
    `siteType === "job"`, it auto-switches to General mode, sets category to
    `cover_letter`, and prefills the prompt — so opening a job page and
    hitting Generate needs no manual setup. Fails silently if the tab isn't
    scriptable (no fresh `activeTab` grant, `chrome://` page, etc.).
  - `settings.js` / `settings.html` — provider credentials, writing-sample
    upload/delete per category.
- **server/** — local FastAPI server (`localhost:8000`), spawned on demand by
  the native host, not run standalone by the user.
  - `server.py` — routes: `/generate-review/*`, `/generate-writing/*`
    (both job-queue style: `/start` returns a `job_id`, poll `/progress/{id}`
    for `{stage, attempt, max_attempts, done}`), `/provider-defaults`,
    sample list/upload/delete.
  - `review_engine.py` — prompt building, provider dispatch (agy CLI,
    Claude Code CLI, OpenRouter, Groq, local endpoint), AI-detection scoring
    + rewrite loop, writing-sample loading. `SAMPLE_CATEGORIES` is the
    whitelist of style categories — each is a real directory under
    `workspace/sample/<category>/` and doubles as the extension's category
    dropdown values. Adding a category = adding a tuple entry + a folder.
  - `secrets_loader.py` — decrypts `config/secrets.enc.yaml` via sops/age for
    default OpenRouter/Groq credentials (used when the extension's own
    Settings page hasn't been filled in).
- **native-host/host.py** — native messaging host Chrome spawns; ensures
  `server/server.py` is running (`--managed` mode), replies `{"status":
  "ready"}`, then blocks on stdin until the extension disconnects.
- **workspace/** — runtime data, not source: `review/`, `writing/` (generated
  output text files), `sample/<category>/` (writing samples per style,
  used for voice-matching).
- **docs/** — `RULES.MD` (must-follow rules injected into every prompt) and
  `MEMORY.MD` (persistent context injected into every prompt). Both are read
  fresh per request in `server.py`.
- **config/** — `secrets.enc.yaml` (sops/age-encrypted), `secrets.example.yaml`.

## Conventions

- No build step / bundler / TypeScript — plain ES modules loaded via
  `<script>` tags in the two HTML pages, plain Python with no framework
  beyond FastAPI.
- `chrome.scripting.executeScript({ func: ... })` targets (like
  `scrapePageContent`, `scrapeProductData`) must stay fully self-contained —
  no references to outer module-scope variables — since they're serialized
  and run in the page's own context. Nested helper functions inside them
  are fine.
- New style/voice categories: add to `SAMPLE_CATEGORIES` in
  `server/review_engine.py` + create `workspace/sample/<name>/.gitkeep` +
  add an `<option>` in `sidebar.html`'s `#category-select`. That's the whole
  extension point — no new backend logic needed.
- External provider calls never silently fall back to agy on failure — they
  raise `ProviderCallError` so the UI surfaces the real error instead of
  masking a misconfigured API key.
- Job-board hostname list in `generic_scrape.js` (`JOB_SITE_HOSTS`) and its
  selector shortlist (`JOB_SELECTORS`) are best-effort, not a registry kept
  perfectly in sync with site redesigns — the keyword-scored fallback exists
  precisely so unlisted/changed sites still degrade reasonably.

## Test / run commands

- No automated test suite exists yet.
- `./setup.sh` — cross-platform install/package script.
- `./reload-extension.sh` — reload the unpacked extension in Chrome during dev.
- `./package.sh` — package the extension for distribution.
- Manual check after any extension change: `chrome://extensions` → reload →
  open a product page (Review mode) or any page (General mode) → Generate.
- Server has no standalone entrypoint for normal use; it's spawned by the
  native host. For direct debugging: `python server/server.py` from `server/`.

## Carryover

- 2026-09-21: Added job-posting auto-detect to General Writer mode. On
  known job boards/ATSes (or any site whose text scores as a job posting),
  `generic_scrape.js` extracts just the job description instead of the full
  page, and `sidebar.js` auto-switches to a new `cover_letter` category on
  panel open. No new mode/pipeline was added — this extends the existing
  General Writer scrape + category-sample mechanism.
  **Not yet done:** no cover-letter writing samples exist yet under
  `workspace/sample/cover_letter/` (folder created, empty) — quality will be
  generic until the user drops some in via Settings.
