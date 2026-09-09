#!/usr/bin/env bash
# One-shot setup for Ghost Writer: creates the venv, installs Python
# dependencies, scaffolds personal config files, and (optionally) installs
# the Chrome native-messaging host. Safe to re-run any time, on any machine
# (macOS or Linux) — e.g. after unzipping this repo onto a fresh box.
#
# Usage:
#   ./setup.sh                     # deps + scaffolding only
#   ./setup.sh <extension-id>      # also installs the native messaging host
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

EXTENSION_ID="${1:-}"

echo "======================================"
echo "        Ghost Writer Setup            "
echo "======================================"
echo ""

# ── Python ──────────────────────────────────────────────────────────────────
PYTHON_BIN="$(command -v python3 || true)"
if [ -z "${PYTHON_BIN}" ]; then
  echo "[error] python3 not found on PATH."
  echo "  Fedora:  sudo dnf install python3"
  echo "  Debian:  sudo apt install python3 python3-venv"
  echo "  macOS:   brew install python3"
  exit 1
fi
echo "[ok] python3: $(${PYTHON_BIN} --version)"

# ── venv ────────────────────────────────────────────────────────────────────
# If .venv exists but its interpreter doesn't run on this machine (e.g. a
# macOS-built .venv unzipped onto Linux), rebuild it from scratch instead of
# failing halfway through pip install.
if [ -d ".venv" ] && ! .venv/bin/python3 -c "" >/dev/null 2>&1; then
  echo "[warn] .venv is broken or from a different OS/architecture — rebuilding it."
  rm -rf .venv
fi

if [ ! -d ".venv" ]; then
  echo "[..] creating .venv"
  "${PYTHON_BIN}" -m venv .venv
fi

echo "[..] installing Python dependencies"
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r server/requirements.txt
echo "[ok] dependencies installed"

# ── Scaffold personal config (never overwrite existing files) ────────────────
if [ ! -f "docs/RULES.MD" ]; then
  cp docs/RULES.MD.example docs/RULES.MD
  echo "[ok] created docs/RULES.MD from the example — edit it to your taste"
fi
if [ ! -f "docs/MEMORY.MD" ]; then
  cp docs/MEMORY.MD.example docs/MEMORY.MD
  echo "[ok] created docs/MEMORY.MD from the example — edit it to your taste"
fi

mkdir -p workspace/review workspace/writing workspace/sample
for category in formal casual academic creative narrative technical review; do
  mkdir -p "workspace/sample/${category}"
done

chmod +x start_server.command native-host/install.sh native-host/host.py 2>/dev/null || true

# ── Optional: generation backends ────────────────────────────────────────────
echo ""
if command -v agy >/dev/null 2>&1; then
  echo "[ok] agy CLI found on PATH — default provider will work out of the box."
elif command -v claude >/dev/null 2>&1; then
  echo "[ok] claude CLI found on PATH — pick 'Claude Code' as the provider in Settings."
else
  echo "[warn] Neither 'agy' nor 'claude' found on PATH."
  echo "  Either install the agy (Antigravity) CLI, install the Claude Code CLI,"
  echo "  or open the extension's Settings page and configure OpenRouter, Groq,"
  echo "  or a local OpenAI-compatible endpoint (Ollama/LM Studio/vLLM/etc)."
fi

# ── Optional: sops-backed default secrets ────────────────────────────────────
if [ -f "config/secrets.enc.yaml" ]; then
  if command -v sops >/dev/null 2>&1; then
    if [ -n "${SOPS_AGE_KEY_FILE:-}" ] || [ -f "${HOME}/.config/sops/age/keys.txt" ]; then
      echo "[ok] sops + age key found — config/secrets.enc.yaml can be decrypted."
    else
      echo "[info] sops is installed but no age key was found."
      echo "  If you want config/secrets.enc.yaml's default OpenRouter/Groq keys to"
      echo "  work on this machine, copy your age key to ~/.config/sops/age/keys.txt"
      echo "  (or set SOPS_AGE_KEY_FILE). Otherwise just fill in Settings by hand —"
      echo "  this is optional."
    fi
  else
    echo "[info] config/secrets.enc.yaml is present but 'sops' isn't installed."
    echo "  This is optional — Settings-page API keys work regardless. To use the"
    echo "  encrypted defaults, install sops (Fedora: sudo dnf install sops)."
  fi
fi

# ── Native messaging host ────────────────────────────────────────────────────
echo ""
if [ -n "${EXTENSION_ID}" ]; then
  ./native-host/install.sh "${EXTENSION_ID}"
else
  echo "Next steps:"
  echo "  1. chrome://extensions -> enable Developer mode -> Load unpacked -> select 'extension/'"
  echo "  2. Copy the extension ID Chrome shows, then run:"
  echo "       ./setup.sh <extension-id>"
  echo "     (or directly: ./native-host/install.sh <extension-id>)"
fi

echo ""
echo "Setup complete."
