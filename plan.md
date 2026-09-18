# Creative-writing flow — plan

Exported here 2026-09-18 from a SemAI ghostwriter-expansion planning session. This repo already
has its own local server (`server/server.py`, `server/review_engine.py`), category samples
(`workspace/sample/<category>/`), an AI-detection refine loop, and configurable providers
(agy default, or OpenRouter/Groq/local model) — the creative-writing flow below is a new nvim
front-end for this repo's existing machinery, self-contained here, not wired to SemAI in any way.

## Goal

A Cursor Ctrl-K/Ctrl-I style in-editor agent call for nvim: finish writing, hit a keybinding,
the agent reads context from the cursor position, refines/expands/proofreads, and on approval
either replaces the selected text or iterates on the user's inline comments.

## UI layer: avante.nvim, not a terminal split

Preference: avante.nvim's right-hand sidebar over opencode's built-in lower-terminal UI —
simpler workflow (finish paragraph, hit shortcut, agent reads from cursor position, diff/approve
inline) without giving up backend flexibility.

avante.nvim supports pluggable custom providers/vendors. Plan: keep avante as the UI/interaction
layer, and register a custom provider that shells out to (or otherwise drives) `opencode` as the
actual executor, rather than using avante's built-in API providers directly. This keeps the
model choice (local vs. API) configurable through `opencode`'s own config surface instead of
duplicating that config inside avante.

## Executor: opencode CLI

`opencode` runs the actual refine/expand/proofread call, configurable to a local model or an
API call (read `opencode`'s existing config for how that toggle normally works — don't
reinvent it here). It should reuse this repo's existing category + AI-detection-refine-loop
logic (`server/review_engine.py`) rather than duplicating that logic inside the nvim plugin —
exact reuse mechanism (import the Python module directly vs. calling the local server's
existing HTTP endpoint) is an implementation decision for whoever picks this up, not decided yet.

## Trigger and interaction

- Keybinding fires on a visual selection, or (no selection) the paragraph containing the cursor.
- Modes: refine, expand, proofread — selectable the same way the existing "General Writer" mode
  picks a category/voice.
- Shows a preview (diff or side-by-side, avante's own convention) before touching the buffer.
- On approval: paste the result over the selected text.
- On inline comments instead of approval: feed the comments back in, agentically retune the
  draft to match, re-show the preview, loop until approved.

## Context handling — no RAG/vector pipeline by default

For a single in-progress document, the right context is the surrounding text itself, not
retrieval: the current file (or a generous window around the cursor — creative documents rarely
exceed a modern model's context window), plus this repo's existing persistent voice/rules
(`docs/RULES.MD`, `docs/MEMORY.MD`) and category samples, same as the existing modes already use.

RAG only earns its complexity if pulling from a large external corpus that can't just be handed
to the model whole — e.g. a "story bible"/character-notes folder spanning many files across a
long project. That's a stretch item, not part of the default flow: a lightweight keyword or
embedding lookup scoped only to that notes folder, added later if a real project needs it.

## Explicitly out of scope

- No ghost-text/autocomplete — refine/expand/proofread on user-provided text only.
- No SemAI involvement of any kind — this flow lives entirely in this repo.
- No RAG/vector store as a default dependency (see Context handling above).

## Open implementation decisions (not yet made)

- Exact reuse path for `review_engine.py`'s refine loop from the nvim/opencode side (import vs.
  local HTTP call to the existing server).
- Exact avante custom-provider wiring for `opencode` as backend.
- Keybinding choice and Lua plugin structure/location within this repo.
