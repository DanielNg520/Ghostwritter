#!/usr/bin/env bash
# Builds a clean, portable zip of this repo for moving to another machine
# (e.g. a Fedora box). Excludes the venv (OS/arch-specific — setup.sh
# rebuilds it on the target machine), __pycache__, and .git, but keeps
# everything else including your personal docs/RULES.MD, docs/MEMORY.MD,
# workspace/sample/*, and config/secrets.enc.yaml (still encrypted).
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
echo "  ./setup.sh"
