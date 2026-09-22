# Ghost Writer — AGENTS.md

Chrome extension (MV3) + local FastAPI server + native-messaging host. Personal
tool: writes Amazon Vine reviews and general-purpose text (cover letters,
essays, etc.) in the user's voice, using local CLIs (agy/claude_code) or
external providers (OpenRouter/Groq/local model) as the LLM backend.

Read this file first. Update it after every implementation change.

## Architecture

- **extension/** — MV3 extension, side-panel UI.
  - `background.js` — service worker. On toolbar click, binds the side panel
    to that specific tab (`chrome.sidePanel.setOptions({tabId, path:
    "sidebar.html?tabId=<id>", enabled: true})`) before opening it, so each
    tab gets its own panel instance instead of one shared panel that follows
    whichever tab is currently focused. Also warms up the native host (which
    ensures the local server is running).
  - `content.js` — static content script, scoped to `*://*.amazon.com/*`
    (see `host_permissions`). Scrapes product title/bullets for Review mode.
  - `generic_scrape.js` — page scraper for General Writer mode. Injected via
    `chrome.scripting.executeScript` (needs only `activeTab`, not broad host
    permissions) so it works on any site. `JOB_SITE_HOSTS`/`JOB_SELECTORS`
    (known job boards/ATSes by hostname, and their description-container
    selectors) find the job *description* text, falling back to a
    keyword-scored heuristic — returns
    `{ title, text, siteType: "job"|"general", employer }`. `employer`
    (company name, or `null`) is `extractEmployer()`'s universal, host-list-
    free heuristic, tried in order: (1) JSON-LD `JobPosting.hiringOrganization`;
    (2) an "About the employer"/"About the company"-style heading followed by
    the company's own name as a heading or link — a content pattern, not a
    per-site selector, so it works on boards not in `JOB_SITE_HOSTS`; (3) a
    link to a company-profile URL (`/company/`, `/employer/`, `/cmp/`, etc.
    path shape, common across many platforms); (4) `<meta property=
    "og:site_name">`, gated by VALUE (substring match against a
    `PLATFORM_BRANDS` list of known job-board/ATS names) rather than by host,
    so it still works on ATSes not in `JOB_SITE_HOSTS` while still rejecting
    a platform's own brand leaking through as the "employer".
  - `sidebar.js` / `sidebar.html` — the panel UI. Reads its own bound tab id
    from `location.search` (`?tabId=<id>`, set by `background.js`) into
    `boundTabId`; `scrapeActiveTab()`/`generateReview()` target that id
    directly instead of querying whichever tab is currently active/focused,
    so the panel always acts on the tab it was opened from — switching tabs
    while it's open does not change what it reads. A panel opened without
    that param (e.g. hit directly, not via the toolbar click) has
    `boundTabId === null`: `scrapeActiveTab()` returns `null` and
    `generateReview()` throws instead of guessing a tab. Two modes:
    **Review** (Amazon) and **General Writer** (any page + free-form prompt
    + a style "category" that pulls matching writing samples). On panel
    open, `detectJobPageAndConfigure()` best-effort-scripts the bound tab; if
    `siteType === "job"`, it auto-switches to General mode, sets category to
    `cover_letter`, and prefills the prompt — so opening a job page and
    hitting Generate needs no manual setup. Fails silently if the tab isn't
    scriptable (no fresh `activeTab` grant, `chrome://` page, etc.).
    `generateWriting()` seeds `#employer-input` (in `#general-section`) from
    the scrape's `employer` on every generation — a plain, user-editable
    text field, not a hidden variable, since no employer heuristic is
    perfect and this feeds directly into a document the user submits; the
    field is the single source of truth `exportCoverLetterPdf()` reads at
    export time, so a wrong auto-detection is a two-second fix before
    export rather than a silent error in the PDF. After a successful
    `cover_letter` generation, an "Export as PDF" button (`#export-pdf-btn`,
    hidden otherwise, and re-hidden on category change so a stale export
    can't follow a category switch) becomes visible; `exportCoverLetterPdf()`
    builds a letterhead from `profileInfo` (Settings → Profile) +
    `#employer-input`'s value + today's date, wrapping each line to the
    page width, then paginates the generated body text via vendored jsPDF
    and saves `<Employer> - Cover Letter.pdf` (filename capped at 180 chars,
    matching `server/review_engine.py`'s `sanitize_filename()`). No server
    round-trip — entirely client-side from the already-approved output text.
  - `settings.js` / `settings.html` — provider credentials, writing-sample
    upload/delete per category, and a Profile section (`profileInfo` in
    `chrome.storage.local`: name/email/phone/address/city/state/zip/
    linkedin) used to fill in the sender block on exported cover letters.
  - `lib/jspdf.umd.min.js` — vendored jsPDF 2.5.2 UMD build (MV3 CSP forbids
    loading it from a CDN). Loaded before `generic_scrape.js`/`sidebar.js`
    in `sidebar.html`, exposes the global `jspdf.jsPDF`.
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
  add an `<option>` in `sidebar.html`'s `#category-select` + add the name to
  `settings.js`'s own (separately hardcoded, not shared) `SAMPLE_CATEGORIES`
  array so the sample-manager UI gets a panel. Four places, not three — the
  `cover_letter` addition missed `settings.js` the first time.
- External provider calls never silently fall back to agy on failure — they
  raise `ProviderCallError` so the UI surfaces the real error instead of
  masking a misconfigured API key.
- Job-board hostname list in `generic_scrape.js` (`JOB_SITE_HOSTS`) and its
  selector shortlist (`JOB_SELECTORS`) are best-effort, not a registry kept
  perfectly in sync with site redesigns — the keyword-scored fallback exists
  precisely so unlisted/changed sites still degrade reasonably. Likewise
  `extractEmployer()`'s `PLATFORM_BRANDS` list (job-board/ATS brand names,
  for the `og:site_name` fallback) is a separate list from `JOB_SITE_HOSTS`
  with no derivation between them (a hostname doesn't reliably map to a
  brand display string) — adding a new ATS to one doesn't automatically
  cover the other; a wrong guess here is also correctable via the panel's
  editable `#employer-input`, so this isn't chased further than best-effort.

## Test / run commands

- `tests/browser/smoke_test.py` — the extension's automated test suite
  (`extractEmployer()`'s heuristics, Settings Profile round-trip, PDF
  export/pagination/filename, panel tab-binding, cross-tab isolation).
  `pip install -r tests/requirements-dev.txt && playwright install
  chromium`, then `python3 tests/browser/smoke_test.py` — self-contained
  (starts its own local fixture server, launches a throwaway Chromium
  profile with the unpacked extension, no manual setup). Fixtures live in
  `tests/browser/fixtures/`. No unit-test suite for `server/`.
- `./setup.sh` — cross-platform install/package script.
- `./reload-extension.sh` — reload the unpacked extension in Chrome during dev.
- `./package.sh` — package the extension for distribution.
- Manual check after any extension change: `chrome://extensions` → reload →
  open a product page (Review mode) or any page (General mode) → Generate.
- Server has no standalone entrypoint for normal use; it's spawned by the
  native host. For direct debugging: `python server/server.py` from `server/`.

## Carryover

- 2026-09-22 (done): a high-effort audit found 4 more real precision gaps
  in `extractEmployer()`, hand-fixed directly: (1) removing "careers"/
  "jobs" from `PLATFORM_BRANDS` (see the entry below) let a *bare*
  `og:site_name` of exactly "Careers"/"Jobs" through as a literal
  employer value — fixed via a shared `isGenericLabel()` exact-match
  check, not by re-adding those words to the substring-matched brand
  list (that would have reintroduced the original false-rejection bug).
  (2) `PLATFORM_BRANDS`' substring match rejected real employers whose
  name contains a brand word, e.g. "Dicerna Pharmaceuticals" via "dice"
  — switched to word-boundary regex matching (a single-word brand that's
  also an ordinary word, e.g. "Monster", can still collide with a real
  company using that literal word — accepted, unresolvable without host
  info). (3) The About-heading candidate scan could pick a numeric
  counter like "58 open jobs" over the real name — added a shared
  pattern check. (4) Stoplists only caught exact matches, missing
  decorated variants ("Company ›", "Follow · 12,483 followers") — now
  normalized (strip leading/trailing chevrons/bullets) before comparing.
  The audit also flagged, correctly, that `BADGE_LABELS`/
  `GENERIC_LINK_LABELS` were 3 separately-maintained stoplists at 3 call
  sites (a "whack-a-mole" pattern that would keep recurring) — 2 and 3
  are now the *same* `GENERIC_LABELS`/`isGenericLabel()` check, function-
  scoped (was previously rebuilt every loop iteration) and shared across
  all three heuristics (About-heading candidates, profile-link text,
  and the bare-`og:site_name` case). Verified with 12 heuristic checks
  (7 prior + 5 new, covering all 4 fixes) plus the rest of the suite —
  26 checks total, now committed as `tests/browser/smoke_test.py` (see
  Test/run commands above) instead of living only in an ephemeral
  session scratchpad. A prior carryover entry below claimed Playwright
  verification without anything reproducible committed to the repo —
  that's corrected going forward by this real, runnable suite.

- 2026-09-22 (done): a medium-effort audit of the universal-employer-
  heuristic work below found 3 more precision gaps, hand-fixed directly:
  (1) `PLATFORM_BRANDS` included bare "careers"/"jobs" words, so a
  legitimate corporate career page's `og:site_name` (e.g. "Acme
  Careers" — an extremely common convention) was wrongly rejected as a
  platform brand via substring match, a real regression versus the old
  behavior; removed both entries. (2) The company-profile-link heuristic
  could return generic nav-link text ("Company", "About", "Home") that
  happens to share the same URL path shape without naming the employer
  at all; added a `GENERIC_LINK_LABELS` stoplist. (3) The "About the
  employer" heading heuristic's candidate scan checked plain next-
  siblings before heading/link elements, so a badge/button
  ("Follow", "Verified") sitting between the heading and the real name
  could win; reordered to try heading/link candidates (higher-confidence)
  first, with a small `BADGE_LABELS` stoplist as a second guard.
  Re-verified with 2 new Playwright regression cases (a legit "X
  Careers" og:site_name, and a nav-link/badge false-positive page) plus
  the full existing suite (30 checks) — all pass.

- 2026-09-22 (done, dispatched via TriAPI): replaced the host-gated
  `og:site_name` employer fallback with a universal, heuristic approach
  that needs no per-site list. `extractEmployer()` in `generic_scrape.js`
  now tries, in order: JSON-LD (unchanged) → an "About the employer"-style
  heading followed by the company's name (a content pattern that works on
  any board, prompted by a real Handshake posting: "About the employer" →
  "UC San Diego") → a link to a company-profile URL (`/company/`,
  `/employer/`, `/cmp/`, etc.) → `og:site_name` gated by a
  `PLATFORM_BRANDS` value-blocklist (substring match, not exact — a
  medium-effort audit caught that exact match let "Greenhouse Job Board"-
  style values slip through) instead of a `JOB_SITE_HOSTS` allowlist. Also
  added a user-editable `#employer-input` field (seeded from the
  detection, source of truth for `exportCoverLetterPdf()`) since no
  heuristic is perfect and a wrong guess here would otherwise land
  silently in a submitted document. The same audit also flagged
  `ABOUT_LABELS`' bare single-word entries ("company", "employer",
  "organization") as too eager to match unrelated headings (form fields,
  sidebar widgets) — narrowed to the specific multi-word phrases only. 4
  tasks (1 agy markup, 1 agy CSS, 2 DeepSeek off-peak ~$0.002), each
  audited before applying; re-verified with Playwright against a
  Handshake-shaped page (label heuristic), a link-only page, an
  og:site_name-only page, and a "Greenhouse Job Board"-style substring
  case — all correct, plus the full existing smoke-test suite still
  passes (30 checks total). Not fixed, accepted as a heuristic limit (see
  Conventions above): the profile-link heuristic takes the first matching
  link in document order with no "does this actually belong to the
  posting I'm looking at" check — a "Similar companies" link elsewhere on
  the page could in principle win; the editable field is the safety net
  for this class of mistake, not a tighter heuristic.

- 2026-09-22 (done): high-effort multi-angle audit (8 finder angles) of
  the Profile/PDF/tab-scoping work below found 6 more real issues beyond
  the earlier passes, hand-fixed directly (small, targeted):
  (1) `background.js`'s prior "await setOptions() before open()" fix
  (see the entry below) was itself wrong — awaiting risks losing the
  user-gesture window `sidePanel.open()` requires. Reverted to Chrome's
  documented pattern: `open()` first (stays synchronous in the click
  handler), `setOptions()` fired right after, both with `.catch()`
  instead of silently dropping a rejection. (2) `#export-pdf-btn` stayed
  visible after switching `#category-select` away from `cover_letter`
  without regenerating, offering a stale/mismatched export — now hidden
  on `categorySelect`'s `change` event. (3) A panel opened without
  `?tabId=` (e.g. via Chrome's own side-panel switcher, which uses the
  manifest's untagged default path) was silently inert with no
  explanation — now sets a status message on load telling the user to
  reopen it from the toolbar icon. (4) `extractEmployer()` only handled
  a bare string/object for JSON-LD `@type`/`hiringOrganization`, missing
  schema.org's valid array forms (co-listed types, co-listed postings) —
  now checks both. (5) Letterhead lines in `exportCoverLetterPdf()` used
  plain `doc.text()` with no width check, unlike the body — a long
  address/LinkedIn URL/employer name could run past the page's right
  margin; now wrapped via the same `doc.splitTextToSize()` approach
  (`drawWrapped()` helper). (6) The exported PDF's filename sanitizer
  had no length cap, unlike `server/review_engine.py`'s
  `sanitize_filename()` (180 chars) — now capped to match. Re-verified
  with the existing Playwright smoke tests plus new checks for all 6
  fixes (unbound-panel message, category-change hiding, wrapped
  long-value letterhead, filename cap) — all pass. Not fixed, by design:
  the `og:site_name` fallback's `JOB_SITE_HOSTS` gate is still
  non-exhaustive on purpose, matching this file's existing "best-effort,
  not a registry to keep perfectly in sync" convention for the same
  heuristic elsewhere in `generic_scrape.js`.

- 2026-09-22 (done): second audit pass (medium effort) on the panel
  tab-scoping change below found `background.js`'s `chrome.sidePanel.
  setOptions()` wasn't awaited before `chrome.sidePanel.open()` — the two
  calls could race, letting the panel occasionally load with the
  manifest's untagged default path instead of the tab-scoped one,
  silently defeating the fix. Hand-fixed directly (one-line, small
  tweak): `onClicked` listener is now `async` and awaits `setOptions()`
  before calling `open()`.

- 2026-09-22 (done, dispatched via TriAPI): panel tab-scoping. The side
  panel used to be one shared instance that followed whichever tab was
  currently active/focused in the window — `sidebar.js` queried
  `chrome.tabs.query({active, currentWindow})`, so switching tabs while
  the panel stayed open silently redirected Generate to the new tab's
  content instead of the tab the panel was opened from (a real cross-tab
  data leak risk). Fixed: `background.js` now binds the panel to the
  clicked tab via `sidePanel.setOptions({tabId, path: "sidebar.html?tabId=
  <id>", enabled: true})`; `sidebar.js` reads that id back out of its own
  URL (`boundTabId`) and targets it directly in `scrapeActiveTab()`/
  `generateReview()`, never the "active" tab. Verified with a Playwright
  test serving two fake job postings over `localhost` (the one host the
  manifest already grants without needing a real toolbar-click gesture):
  with tab B (Globex) frontmost, a panel opened bound to tab A (Acme)
  still read only tab A's content; a panel opened with no `tabId` param
  correctly refused to read anything or generate. 2 tasks (1 agy, 1
  DeepSeek off-peak, ~$0.0012), each audited before applying.

- 2026-09-22 (done): code-review audit (medium effort) of the Profile/PDF
  feature below found and fixed 2 real bugs, both hand-fixed directly
  (small, targeted — not routed through TriAPI): (1) `lastEmployer` in
  `sidebar.js` only updated when the new scrape found an employer, so a
  cover letter generated for a page where detection failed kept showing
  the *previous* job's employer in the exported PDF — now unconditionally
  overwritten every `generateWriting()` call. (2) `extractEmployer()`'s
  `og:site_name` fallback in `generic_scrape.js` picked up the ATS
  platform's own brand (e.g. "Greenhouse") on `JOB_SITE_HOSTS` domains
  instead of the real employer — now only used on non-listed (company's
  own) domains. A third finding — `review_engine.py`'s `run_agy()`
  default effort was previously changed from `high` to `low`, which
  silently downgrades the main generation call, not just the cheap
  AI-score check that already opts into `low` explicitly — was **not**
  auto-reverted since it was the user's own prior pending edit, not part
  of this feature; flagged for the user to confirm intent.

- 2026-09-22 (done): smoke-tested the Profile + PDF export feature (below)
  via a self-contained Playwright session (`--load-extension`, separate
  from the user's real Chrome profile) rather than the user's live
  browser, since loading an unpacked extension needs a fresh Chrome
  process. 16/16 feature checks passed: `scrapePageContent()` employer
  extraction from JSON-LD on a synthetic job page, Settings → Profile
  save/reload round-trip through `chrome.storage.local`, `#export-pdf-btn`
  hidden by default, and an actual multi-page PDF generated via
  `exportCoverLetterPdf()` (verified with `pypdf`: correct sender
  letterhead, date, and paginated body). 2 unrelated console errors
  (`ERR_CONNECTION_REFUSED` fetching `localhost:8000`) are expected — the
  local FastAPI server wasn't running in the isolated test profile.

- 2026-09-22 (done, dispatched via TriAPI rebuild pipeline per the
  hand-write-vs-dispatch rule — this was "big stuff", not a small tweak):
  Profile + cover-letter PDF export. Added a Profile section to
  Settings (`profileInfo` in `chrome.storage.local`); extended
  `scrapePageContent()` to extract `employer` from JSON-LD `JobPosting`
  data / `og:site_name`; vendored jsPDF (`extension/lib/jspdf.umd.min.js`,
  CDN loading is CSP-blocked under MV3); added `exportCoverLetterPdf()` to
  `sidebar.js`, wired to a new `#export-pdf-btn` that appears after a
  successful cover-letter generation. All 6 sub-tasks planned and prompted
  by Claude, written by DeepSeek (2 tasks, off-peak, ~$0.0017 total) / agy
  (4 tasks), each audited before applying — see TriAPI's own task queue
  for the individual task records. Not yet done: no in-extension UI
  validation (Chrome not driven this session) — user should smoke-test
  Settings → Profile save/reload and a real Export-as-PDF click on an
  actual job posting before relying on it for a real submission.

- 2026-09-21 (in progress, uncommitted): two local edits pending
  verification — `sidebar.css` `#output` changed from a fixed
  `min-height: 160px` to `flex: 1 1 160px; min-height: 0` (flex-fills the
  panel instead of a fixed height); `review_engine.py`'s `run_agy()`
  default model/effort changed `gemini-3.7-flash/high` →
  `gemini-3.7-pro/low`. Not yet verified in Chrome/against real agy calls.

- 2026-09-21 (done): code review of the any-host keyword-fallback fix
  flagged that `findByKeywordScore` now walks and regex-scans every
  `main/article/section/div` on *any* page (not just the 16
  `JOB_SITE_HOSTS`), including huge SPAs (Gmail, Twitter/X) — and
  `detectJobPageAndConfigure()` runs this on every side-panel open, on any
  page. Fixed with a cheap single-pass gate: check `document.body
  .textContent` against `JOB_KEYWORDS` once first, only do the expensive
  per-element candidate scan if that already clears `minMatches`. Verified
  no behavior change (same job/general results on all prior test pages)
  and benchmarked on a synthetic 4000-level-deep page (worst case for
  nested-`textContent` overlap): 13.9ms gated vs. 28.9ms ungated, and the
  realistic case (zero job vocabulary on the page, e.g. an inbox) skips
  the per-element scan entirely.

- 2026-09-21 (done): audit found `settings.js` keeps its own hardcoded
  `SAMPLE_CATEGORIES` array (separate from `review_engine.py`'s), missed
  when `cover_letter` was added — the Settings sample-manager UI had no
  panel to upload cover-letter samples at all. Fixed, plus a `capitalize()`
  bug it exposed: it only uppercased the first letter, so `cover_letter`
  rendered as "Cover_letter" (every prior category was one word). Verified
  in Chrome: panel now reads "Cover Letter", no console errors. Also
  updated `README.md` (Cover Letter category + auto-detect weren't
  mentioned) and the Conventions section below (was missing this file as
  a required edit point).

- 2026-09-21 (done): tested the job-detection feature in Chrome via
  Playwright with the unpacked extension loaded headless (no Xvfb needed —
  full `chrome` binary + `--headless=new`, not the default headless-shell,
  which can't load extensions). Confirmed sidebar UI, mode toggle, and the
  `cover_letter` category render correctly. Found and fixed a real gap: the
  keyword-score fallback in `generic_scrape.js` only ran on `JOB_SITE_HOSTS`
  domains, so a real job description on a company's own domain (e.g.
  `stripe.com/careers/listing/...`, the common case — most ATS postings are
  custom-domain, not `boards.greenhouse.io`) was misclassified as
  `"general"`. Fixed: `findByKeywordScore` now runs on any host, with a
  stricter match threshold (3 vs. 1) off the known-host list to avoid
  false positives. Also fixed a minor mislabel where a known-host page with
  no extractable content (e.g. a LinkedIn login wall) was tagged `"job"`
  anyway just from the hostname match; it now requires actual extracted
  content. Known residual false positive: a page that discusses job
  descriptions as a topic (not an actual posting) can still trip the
  keyword threshold — accepted tradeoff, not worth tightening further at
  the cost of recall on real short postings.

- 2026-09-21 (done): removed `docs/plan.md` and `docs/plan_v2_generalist.md`
  — both were 100% completed historical build logs (v1 extension plan,
  generalist-writer/on-demand-server plan), referencing files that no
  longer exist (`run_ghost_writer.py`). Per doc hygiene, completed plans
  get trimmed, not kept as tracked files. Fixed the now-stale references
  to them in `README.md`'s architecture tree.

- 2026-09-21 (done, committed `7723bc8`): Added job-posting auto-detect to
  General Writer mode. On known job boards/ATSes (or any site whose text
  scores as a job posting), `generic_scrape.js` extracts just the job
  description instead of the full page, and `sidebar.js` auto-switches to a
  new `cover_letter` category on panel open. Extends the existing General
  Writer scrape + category-sample mechanism, no new mode/pipeline.
  Code-reviewed (medium effort) and 3 findings fixed: hostname check now
  requires an exact/`.`-suffix match (was a bare `endsWith`, so
  `notindeed.com` false-positived); `JOB_KEYWORDS` regex now has the `g`
  flag (was capping match count at 1, making the density score binary);
  extracted a shared `scrapeActiveTab()` helper in `sidebar.js` (was
  duplicated between `detectJobPageAndConfigure` and `generateWriting`).
  **Not yet done:** no cover-letter writing samples exist yet under
  `workspace/sample/cover_letter/` (folder created, empty) — quality will
  be generic until the user drops some in via Settings.

- **Next item (not started): nvim creative-writing flow.** Cursor
  Ctrl-K/Ctrl-I-style in-editor agent call for nvim — finish writing, hit a
  keybinding, agent reads context from cursor position, refines/expands/
  proofreads, and on approval replaces selected text or iterates on inline
  comments. Full design below; this is the only carryover plan, per doc
  hygiene there is no separate plan.md.

  - **UI layer:** avante.nvim's right-hand sidebar (not opencode's built-in
    terminal UI) — finish paragraph, hit shortcut, agent reads from cursor,
    diff/approve inline. avante.nvim supports pluggable custom
    providers/vendors; register a custom provider that shells out to (or
    otherwise drives) `opencode` as the executor, so model choice (local vs.
    API) stays configured through `opencode`'s own config surface instead of
    duplicating it inside avante.
  - **Executor:** `opencode` CLI runs the actual refine/expand/proofread
    call. It should reuse this repo's existing category + AI-detection
    refine-loop logic (`server/review_engine.py`) rather than duplicating it
    in the nvim plugin — exact reuse mechanism (import the Python module
    directly vs. call the local server's existing HTTP endpoint) is an open
    decision for whoever picks this up.
  - **Trigger/interaction:** keybinding fires on a visual selection, or (no
    selection) the paragraph containing the cursor. Modes: refine, expand,
    proofread — selected the same way General Writer picks a category/voice.
    Shows a preview (diff or side-by-side, avante's convention) before
    touching the buffer. On approval: paste result over selection. On inline
    comments instead: feed them back in, retune the draft, re-show preview,
    loop until approved.
  - **Context handling:** no RAG/vector pipeline by default — for a single
    in-progress document, the right context is the surrounding text itself
    (current file or a generous window around the cursor), plus this repo's
    existing `docs/RULES.MD`/`docs/MEMORY.MD` and category samples, same as
    the existing modes. RAG only earns its complexity for something like a
    large "story bible"/character-notes folder spanning many files — a
    stretch item, not the default flow.
  - **Explicitly out of scope:** no ghost-text/autocomplete (refine/expand/
    proofread on user-provided text only); no SemAI involvement of any
    kind — this flow lives entirely in this repo; no RAG/vector store as a
    default dependency.
  - **Open decisions:** exact reuse path for `review_engine.py`'s refine
    loop from nvim/opencode (import vs. local HTTP call); exact avante
    custom-provider wiring for `opencode`; keybinding choice and Lua plugin
    structure/location within this repo.
