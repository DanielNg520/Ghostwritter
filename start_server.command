#!/bin/bash
set -euo pipefail

# Run from the script's own directory regardless of where it's launched from
cd "$(dirname "$0")"

echo "======================================"
echo "        Ghost Writer API Server       "
echo "======================================"
echo ""

# ── Dependency checks ──────────────────────────────────────────────────────
if ! command -v agy &>/dev/null; then
    echo "[error] 'agy' is not installed or not in PATH."
    read -n 1 -s; exit 1
fi

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    .venv/bin/pip install --quiet fastapi uvicorn requests
fi

echo "Starting server at http://127.0.0.1:8000 ..."
.venv/bin/python3 server/server.py
