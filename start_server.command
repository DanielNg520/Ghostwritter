#!/bin/bash
set -euo pipefail

# Run from the script's own directory regardless of where it's launched from
cd "$(dirname "$0")"

echo "======================================"
echo "        Ghost Writer API Server       "
echo "======================================"
echo ""

# ── Dependency checks ──────────────────────────────────────────────────────
if ! command -v agy &>/dev/null && ! command -v claude &>/dev/null; then
    echo "[warn] Neither 'agy' nor 'claude' is on PATH."
    echo "       Configure OpenRouter/Groq/a local model in Settings, or install one of them."
fi

# Rebuild .venv if it's missing or was built for a different OS/machine
# (e.g. this repo was unzipped from another computer).
if [ -d ".venv" ] && ! .venv/bin/python3 -c "" >/dev/null 2>&1; then
    echo "[warn] .venv looks broken (wrong OS/arch?) — rebuilding it."
    rm -rf .venv
fi

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
.venv/bin/pip install --quiet -r server/requirements.txt

echo "Starting server at http://127.0.0.1:8000 ..."
.venv/bin/python3 server/server.py
