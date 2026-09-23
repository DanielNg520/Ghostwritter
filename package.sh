#!/usr/bin/env bash
# Builds a clean, portable zip of the extension source for moving to another
# machine. Excludes .venv, __pycache__ and .git. Rules/memory/samples/API keys
# live in the browser's chrome.storage, not in the repo — they don't travel
# with this zip (re-enter them in Settings or use Settings -> Import Backup).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

REPO_NAME="$(basename "${SCRIPT_DIR}")"
OUT="${1:-${REPO_NAME}.zip}"

rm -f "${OUT}"
zip -rq "${OUT}" "${REPO_NAME}" \
  -x "${REPO_NAME}/.venv/*" \
  -x "${REPO_NAME}/.git/*" \
  -x "${REPO_NAME}/*/__pycache__/*" \
  -x "${REPO_NAME}/**/__pycache__/*" \
  -x "${REPO_NAME}/.DS_Store"

echo "Wrote ${OUT} ($(du -h "${OUT}" | cut -f1))"
echo ""
echo "On the target machine:"
echo "  unzip ${OUT}"
echo "  cd ${REPO_NAME}"
echo "  chrome://extensions -> Developer mode -> Load unpacked -> ${REPO_NAME}/extension"
