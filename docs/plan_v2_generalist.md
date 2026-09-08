# Ghost Writer v2 — Generalist Writer + On-Demand Server Plan

Status legend: `[ ]` todo, `[~]` in progress, `[x]` done, `[!]` blocked/needs review.

This file is the source of truth for this initiative. Any worker (agent or human)
picking up a phase should read this file first, implement only their phase,
check off tasks as completed, and leave a one-line note under "Worker notes"
at the bottom if something deviated from the plan. Do not start a phase whose
dependencies aren't checked off.

## Goals

1. **On-demand server** — the local Python backend is no longer a
   double-click-and-leave-running daemon. Chrome starts it (via a Native
   Messaging host) only while the side panel is open/in use, and it dies
   shortly after the panel closes or goes idle.
2. **Generalist writer mode** — alongside the existing Amazon Vine review
   flow ("Product Review" mode, unchanged in shape/behavior), add a
   "General Writer" mode: reads the current page (any site), takes a free
   prompt, picks a voice category, and writes whatever is asked, run
   through the same AI-detection refine loop and saved to disk like reviews
   are today.
3. **Category-based writing samples** — samples live under
   `workspace/sample/<category>/` (formal, casual, academic, creative,
   narrative, technical, review). Users manage them from the Settings UI:
   upload a file or paste text, per category. The server saves + normalizes
   everything to `.md` under the right category folder.
4. **UI polish** — mode toggle, category picker, sample manager, cleaner
   visual design in both sidebar and settings pages.
5. **Icons** — already live in `extension/icons/` and are git-tracked;
   confirm nothing external needs moving in and add any new icons there.

---

## Architecture after this change

```
Ghostwriter/
├── extension/
│   ├── manifest.json          <- add "nativeMessaging" permission, mode-aware content script setup
│   ├── background.js          <- opens side panel; owns the native messaging port lifecycle
│   ├── content.js              <- Amazon-specific scraper (unchanged, static content script)
│   ├── generic_scrape.js       <- NEW: injected on-demand via chrome.scripting for General mode (any site)
│   ├── sidebar.html/css/js     <- mode toggle (Review / General), category picker, redesigned UI
│   ├── settings.html/css/js    <- provider settings + NEW sample manager (upload/paste per category)
│   └── icons/
├── native-host/                <- NEW
│   ├── host.py                  <- native messaging host: on connect, ensures server is running;
│   │                                on disconnect, starts idle-shutdown timer
│   ├── com.ghostwriter.host.json.template  <- native host manifest template (path + extension id filled by installer)
│   ├── install.sh               <- macOS/Linux installer: writes manifest into Chrome's NativeMessagingHosts dir
│   └── install.ps1              <- Windows installer (registry-based)
├── server/
│   ├── server.py                <- add /generate-writing, /samples (GET/POST/DELETE), idle-tracking middleware
│   └── review_engine.py         <- category-aware sample loading, generalist prompt builder, sample save/parse
├── docs/
│   └── plan_v2_generalist.md   <- this file
└── workspace/
    ├── review/                  <- unchanged: Product Review outputs
    ├── writing/                 <- NEW: General Writer outputs
    └── sample/
        ├── Writing guide.md              <- root-level files: ALWAYS included, any mode/category
        ├── Writing_Style_Guide.md
        ├── review/                       <- used by Product Review mode
        ├── formal/
        ├── casual/
        ├── academic/
        ├── creative/
        ├── narrative/
        └── technical/
```

Key rule carried over from v1: any file placed directly in `workspace/sample/`
(not inside a category folder) is always injected in full, regardless of
mode/category. Files inside a category folder are only injected when that
category is active (Product Review implicitly uses `review/`; General
Writer uses whichever category the user picked).

---

## Phase 0 — Sample migration (do first, no code)

- [x] Move existing flat files in `workspace/sample/` into category folders
      by their filename prefix (`academic_*` → `academic/`, `casual_*` →
      `casual/`, `creative_*` → `creative/`, `formal_*` → `formal/`,
      `narrative_*` → `narrative/`, `technical_*` → `technical/`,
      `review.txt` → `review/review.md`). DONE 2026-09-08.
      `Writing guide.md` / `Writing_Style_Guide.md` stay at the root.
- [x] Verify file counts before/after match (nothing lost). Confirmed:
      17 sample files + 1 renamed review.md = 18, all accounted for.

## Phase 1 — Server: category-aware samples + generalist endpoint

Depends on: Phase 0.

- [x] `review_engine.py`: replace flat `read_samples()` with
      `read_samples(category=None)` — always includes root-level files
      first, then packs in files from `workspace/sample/<category>/` if a
      category is given (same 60k char budget logic as today).
- [x] `review_engine.py`: add `list_sample_categories()` and
      `list_samples(category)` (filenames only) for the Settings UI.
- [x] `review_engine.py`: add `save_sample(category, filename, content)` —
      sanitizes filename, forces `.md` extension, writes under
      `workspace/sample/<category>/`. If given raw uploaded text that isn't
      already markdown, just save as-is with `.md` extension (no heavy
      parsing dependency — plain text is valid markdown).
- [x] `review_engine.py`: add `delete_sample(category, filename)`.
- [x] `review_engine.py`: add `build_generalist_prompt(page_title, page_text,
      user_prompt, category, context_block, samples_text)` — mirrors
      `build_text_prompt` shape (same instruction style, same "Output ONLY
      the finished text" ending) but generic: no product-review framing,
      just "write what the user asked, using the page as reference material
      if relevant, in the voice of the samples below."
- [x] `server.py`: `POST /generate-writing` — body `{page_title, page_text,
      user_prompt, category, provider, api_key, model, endpoint}`. Same
      generate → ai_score → refine loop as `/generate-review`, saves to
      `workspace/writing/` via a new `unique_writing_path()` (reuse
      `sanitize_filename`), named from a short slug of `user_prompt` (or
      `page_title` if prompt is empty).
- [x] `server.py`: `GET /samples` → `{categories: {formal: [...files], ...}}`.
- [x] `server.py`: `POST /samples` → body `{category, filename, content}`,
      calls `save_sample`.
- [x] `server.py`: `DELETE /samples` → body/query `{category, filename}`.
- [x] Keep `/generate-review` behavior byte-for-byte identical (this is the
      "retain review shape" requirement) except that its sample lookup now
      calls `read_samples("review")` instead of the old flat `read_samples()`.

## Phase 2 — Server: idle self-shutdown

Depends on: Phase 1.

- [x] `server.py`: add a `last_activity` timestamp updated by a middleware
      on every request.
- [x] Background thread (started in `if __name__ == "__main__"`) that checks
      every 30s; if `now - last_activity > IDLE_TIMEOUT_SECONDS` (default
      300s / 5 min) AND the process was launched by the native host (see
      Phase 3 — passed via `--managed` CLI flag or an env var), call
      `os._exit(0)`. When run manually via `start_server.command` (no
      `--managed` flag), never self-exit — keeps the manual/dev workflow
      working exactly as before.

## Phase 3 — Native messaging host (auto start/stop)

Depends on: Phase 2.

- [x] `extension/manifest.json`: add `"nativeMessaging"` permission, and pin
      a stable extension `"key"` field (generate a keypair once) so the
      extension ID never changes across reloads — the native host manifest's
      `allowed_origins` needs a fixed ID.
- [x] SECURITY: `server.py`'s CORS is currently `allow_origins=["*"]` (a
      pre-existing v1 choice), which is now riskier since `/samples`
      accepts arbitrary file writes/deletes and `/generate-writing` can be
      pointed at arbitrary API keys — any webpage's JS can currently call
      `localhost:8000` directly. Once the extension ID is pinned above,
      change CORS to `allow_origins=["chrome-extension://<ID>"]` instead of
      `"*"`.
- [x] `native-host/host.py`: reads/writes native messaging protocol
      (4-byte little-endian length prefix + JSON, on stdin/stdout per
      Chrome's spec). On start: check if `127.0.0.1:8000/health` responds;
      if not, spawn `server/server.py --managed` as a subprocess (detached,
      own process group). Relay a `{status: "ready"}` message back. Then
      just block reading stdin; on EOF (Chrome closed the port — happens
      when the side panel disconnects), wait a short grace period (e.g. 10s,
      to survive quick reconnects like a side-panel re-render) then send
      the managed server process SIGTERM if still running and no other
      native host instance is alive for this extension.
      **Simplified (see Worker notes): no grace-period/SIGTERM hunt — see
      below.**
- [x] `native-host/com.ghostwriter.host.json.template`: standard Chrome
      native messaging manifest shape (`name`, `description`, `path`,
      `type: stdio`, `allowed_origins: ["chrome-extension://<ID>/"]`).
- [x] `native-host/install.sh`: takes the extension ID (or reads it from
      `extension/manifest.json`'s key if present), writes the filled-in
      manifest JSON to
      `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
      (macOS) with the absolute path to `host.py`, and `chmod +x host.py`.
- [x] `background.js`: on `chrome.action.onClicked` (or side panel open),
      `chrome.runtime.connectNative("com.ghostwriter.host")`, keep the port
      reference; add `port.onDisconnect` handling/logging. Disconnect the
      native port when the side panel's own port (see sidebar.js) tells
      background.js it unloaded.
      **Simplified: no explicit disconnect-on-sidebar-unload wiring — see
      Worker notes.**
- [x] `sidebar.js`: open a `chrome.runtime.connect({name: "sidebar"})` port
      to background.js on load, so `background.js` can detect panel close
      via `port.onDisconnect` and in turn disconnect the native messaging
      port, triggering the host's shutdown timer.
      Done by supervisor after Phases 4/5 landed (was left unassigned to
      avoid merge conflicts during parallel work — see Worker notes). Note
      the "disconnect native port on unload" half was already simplified
      away per the Phase 3 worker's note below; this just wires the port
      open so background.js's existing `onConnect` "sidebar" listener
      actually fires.
- [x] `native-host/install.ps1` (Windows best-effort, added ahead of being
      explicitly checklisted above but listed in the architecture diagram).
- [x] `start_server.command` stays as a manual fallback/dev tool (README
      notes it's now optional — normal use no longer needs it). Verified:
      it calls `server.py` with no `--managed` flag, so the idle-shutdown
      watchdog never starts — matches Phase 2's design exactly, no code
      change needed. README documents this. (The README note is
      Phase 7 scope, not done here.)

## Phase 4 — Extension: generalist mode + generic page scraping

Depends on: Phase 1 (endpoints must exist).

- [x] `extension/generic_scrape.js`: a plain function (not a static content
      script) that returns `{title, text}` — `document.title` plus visible
      text from `<article>`/`<main>` if present, else `document.body`, with
      `<script>/<style>/<nav>/<header>/<footer>` stripped from a cloned
      node before reading `innerText`, capped at ~20,000 chars.
- [x] `sidebar.js`: for General Writer mode, use
      `chrome.scripting.executeScript({target: {tabId}, func: <inline copy
      of the scraper>})` (relies on `activeTab`, already granted — no new
      host permissions needed) instead of `chrome.tabs.sendMessage` to a
      static content script.
- [x] `sidebar.html`: add a mode toggle (Product Review / General Writer).
      General mode shows: category `<select>` (Formal/Casual/Academic/
      Creative/Narrative/Technical), a prompt `<textarea>`, and reuses the
      existing output area / AI-score display / Generate button.
- [x] `sidebar.js`: route to `/generate-review` or `/generate-writing`
      depending on mode; keep the provider-settings plumbing shared.

## Phase 5 — Settings UI: sample manager

Depends on: Phase 1.

- [x] `settings.html`: new "Writing Samples" section, one sub-panel per
      category (tabs or an accordion): for each, show the current sample
      files (name + delete button, fetched from `GET /samples`), a file
      `<input type="file" accept=".txt,.md">` uploader, and a "paste text"
      textarea + filename field + "Add Sample" button.
- [x] `settings.js`: file upload reads via `FileReader.readAsText`, then
      `POST /samples` with `{category, filename, content}`; same call path
      for pasted text. Refresh the list after add/delete. Handle "server
      not running" gracefully (native host should auto-start it on
      settings-page interactions too — settings page also opens a native
      messaging port on load, same pattern as sidebar).

## Phase 6 — UI visual polish

Depends on: Phases 4 and 5 (so it polishes final markup, not throwaway).

- [x] `sidebar.css`: consistent spacing/typography scale, clear mode-toggle
      control, visible AI-score badge (color-coded), better loading state
      (spinner, not just text swap).
- [x] `settings.css`: tidy layout for provider rows + new sample-manager
      tabs, consistent with sidebar's visual language.
- [x] Reuse `extension/icons/` assets where a small icon helps (e.g. mode
      toggle icons); do not introduce new external asset dependencies.

## Phase 7 — Docs

Depends on: everything else checked off.

- [x] Rewrite `README.md`: new setup step for `native-host/install.sh`,
      explain the two modes, explain category sample folders and the
      Settings UI uploader, update the architecture diagram and
      troubleshooting section (server no longer needs manual start/stop in
      normal use; note the manual fallback still exists for dev). Done by
      supervisor.
- [x] Update `.gitignore` if new personal-content paths need excluding
      (`workspace/writing/*` like `workspace/review/*`; the new
      `workspace/sample/<category>/` subfolders need the same "ignore
      content, keep structure" treatment as the old flat samples dir). Done
      by supervisor — verified with `git check-ignore -v` that category
      subfolders keep their `.gitkeep` tracked while file contents stay
      ignored, and that `workspace/writing/` follows the same pattern as
      `workspace/review/`.

---

## Non-goals / explicitly out of scope

- No PDF/DOCX parsing for sample uploads — `.txt`/`.md`/pasted text only.
- No Windows/Linux native-host installer polish beyond a best-effort script
  (macOS is the primary target here).
- No change to the AI-detection scoring approach itself.
- Chrome Web Store packaging/signing is out of scope.

## Worker notes

(Append short notes here if a phase deviates from this plan — filename, why, what changed.)
- Phase 6: No dedicated AI-score badge element was added — `sidebar.js` never
  reads `data.ai_score` from the `/generate-review` or `/generate-writing`
  response (only `data.review`/`data.writing` and `data.provider_warning`
  reach the DOM, via `#status-message`), so there was no existing hook to
  style, and adding one would mean inventing new DOM/JS wiring outside this
  phase's CSS/markup-only scope. Instead `#status-message` was polished into
  a colored, bordered pill (via `:not(:empty)`) so whatever text lands there
  reads clearly. Only one icon asset family exists in `extension/icons/` (a
  single logo at four sizes, no per-mode icons), so it's used once as a
  small app-icon logo next to the "Ghost Writer" / "Ghost Writer Settings"
  headers rather than duplicated on both mode-toggle buttons, which
  wouldn't visually distinguish anything. Minor markup-only changes:
  `sidebar.html` gained a `#header-bar` wrapper (icon + `h1` + the existing
  `#settings-btn`, same id) and inner spinner/text spans inside the
  existing `#loading` div (still toggled via `.hidden` by `sidebar.js`,
  untouched); `settings.html` gained a `#page-header` wrapper,
  `<section class="settings-section">` wrappers, and a `.section-divider`
  `<hr>` for visual grouping — no `id`/`class` that `sidebar.js` or
  `settings.js` reference was renamed or removed (re-verified by re-grepping
  both files' `getElementById`/`querySelector` calls against the final
  markup after the CSS/HTML edits).
- Phase 1: `PRIORITY_SAMPLE_FILENAME` constant removed from `review_engine.py` — root-level sample inclusion is now generalized to all files directly in `workspace/sample/`, so a single named-file special case no longer applies. `save_sample` overwrites an existing file of the same sanitized name instead of appending "(2)" (documented as a deliberate choice in the plan and in a code comment) since re-uploading a sample to fix it is a normal workflow. Also added the trivial `GET /health` endpoint and `WRITING_DIR` (`workspace/writing/`, auto-created) as instructed, even though those are formally adjacent to Phase 1/3 scope.
- Phase 4: Used a single shared "Generate" button for both modes (label swaps between "Generate Review" / "Generate Writing" via `setMode()`) rather than two separate buttons, to avoid duplicating the loading/disable/error-handling wiring. `generic_scrape.js` defines `scrapePageContent()` as a plain global function (loaded via a `<script>` tag in `sidebar.html` before `sidebar.js`) rather than inlining a duplicate copy of the function inside `sidebar.js`; `chrome.scripting.executeScript({ func: scrapePageContent })` references it directly. The function itself has no outer-scope references, so it still satisfies the "self-contained, injectable" requirement even though it lives in its own file. Category `<select>` includes all 7 valid categories (added "Review" alongside the 6 the plan phase-4 section named, to match Phase 1's `SAMPLE_CATEGORIES` and the sidebar.html spec in the "Implement" instructions, which explicitly lists all 7). Did not touch `manifest.json` or `background.js` per instructions — existing `activeTab`/`scripting` permissions are sufficient for `chrome.scripting.executeScript`, no manifest change needed for this phase.
- Phase 5: Generated the 7 per-category sample panels dynamically in `settings.js` from a `SAMPLE_CATEGORIES` array (rather than hand-writing 7 near-identical HTML blocks in `settings.html`) to avoid markup drift; `settings.html` only adds a heading, intro paragraph, a status div, and an empty `#samples-section` container that JS populates on load. Delete/upload/add-sample error handling reuses the same "Could not load samples — make sure Ghost Writer's server is running." message for all sample-related fetch failures (load/add/delete), phrased to match the tone of sidebar.js's existing "Make sure the background server is running!" catch-block message. Did not implement a native-messaging port from the settings page (that's Phase 3 scope, not yet done/owned by another worker) — the sample manager degrades gracefully with the status message when `localhost:8000` isn't reachable, same behavior the plan describes as the fallback case.
- Phase 2: Implemented exactly as specced — `last_activity` module global updated by an `@app.middleware("http")`, a daemon thread started only when `--managed` is passed, checking every 30s and calling `os._exit(0)` past `IDLE_TIMEOUT_SECONDS` (300s). No deviations.
- Phase 3: Simplified `native-host/host.py`'s shutdown story per explicit task direction (this supersedes the plan's original "SIGTERM the managed server on EOF, after a grace period, if no other host instance is alive" language, which isn't achievable anyway since each `connectNative()` call spawns an independent `host.py` process with no shared state to detect "other instances"): host.py's only job is to auto-start the server on demand (checks `/health`, spawns `server.py --managed` via `.venv/bin/python` if present else `sys.executable`, polls up to 10s, replies `{status: "ready"}` or `{status: "error", message}`); on stdin EOF it just `sys.exit(0)`, relying entirely on Phase 2's idle timer inside the managed server to self-terminate. Correspondingly, `background.js` does not implement an explicit "disconnect native port when sidebar port disconnects" handshake (that plan line assumed host.py needed a kill signal, which it no longer does) — it only opens `connectNative` on toolbar click and on a `"sidebar"`-named `onConnect` (ready for a future `sidebar.js` to connect to, once another worker adds it — not built here, sidebar.js is out of scope). Generated a real RSA keypair for `extension/manifest.json`'s `"key"` field and computed the resulting Chrome extension ID directly (`djollbmehcmhelbfnhhogookmleldfmc`, via SHA-256 of the DER public key mapped a-p per Chrome's algorithm) rather than leaving it for manual lookup — used that ID to also complete the Phase-3-listed CORS lockdown (`allow_origins=["chrome-extension://djollbmehcmhelbfnhhogookmleldfmc"]` in `server.py`, replacing `"*"`). This ID will only be valid as long as `extension/manifest.json`'s `key` field is preserved as-is; if the user regenerates it, both the CORS origin and `native-host/install.sh`'s argument must be updated to match. Added `native-host/install.ps1` (Windows best-effort) though it wasn't in the explicit Phase 3 checklist bullets — it's named in the architecture diagram and requested in the worker task.
