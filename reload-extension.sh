#!/usr/bin/env bash
# Dev-loop helper: quits and relaunches Chrome with Ghost Writer loaded
# unpacked, so a code edit is reflected without going through chrome://extensions
# by hand. Chrome only picks up --load-extension on a fresh process launch,
# so there's no way to do this without closing the browser first (see
# setup.sh, which this script's Chrome-loading logic mirrors).
#
# Usage:
#   ./reload-extension.sh             # prompts before quitting Chrome
#   ./reload-extension.sh -y          # skip the confirmation prompt
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

SKIP_CONFIRM=0
for arg in "$@"; do
  case "${arg}" in
    -y|--yes) SKIP_CONFIRM=1 ;;
  esac
done

EXTENSION_DIR="${SCRIPT_DIR}/extension"

PYTHON_BIN="$(command -v python3 || true)"
if [ -z "${PYTHON_BIN}" ]; then
  echo "[error] python3 not found on PATH (needed to derive the extension ID)."
  exit 1
fi

EXTENSION_ID="$("${PYTHON_BIN}" - <<'PYEOF'
import base64, hashlib, json
manifest = json.load(open("extension/manifest.json"))
key_bytes = base64.b64decode(manifest["key"])
digest = hashlib.sha256(key_bytes).hexdigest()
print("".join(chr(int(c, 16) + ord("a")) for c in digest[:32]))
PYEOF
)"

find_chrome_binary() {
  case "$(uname -s)" in
    Darwin)
      for candidate in \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        "/Applications/Chromium.app/Contents/MacOS/Chromium" \
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"; do
        if [ -x "${candidate}" ]; then echo "${candidate}"; return; fi
      done
      ;;
    Linux)
      for candidate in google-chrome-stable google-chrome chromium-browser chromium brave-browser microsoft-edge-stable; do
        if command -v "${candidate}" >/dev/null 2>&1; then command -v "${candidate}"; return; fi
      done
      ;;
  esac
}

wait_for_exit() {
  # $1 = pgrep pattern
  for _ in $(seq 1 20); do
    pgrep -f "$1" >/dev/null 2>&1 || return 0
    sleep 0.5
  done
}

CHROME_BIN="$(find_chrome_binary || true)"
if [ -z "${CHROME_BIN}" ]; then
  echo "[error] No Chrome/Chromium/Brave/Edge binary found."
  echo "  Load it manually: chrome://extensions -> enable Developer mode -> Load unpacked -> '${EXTENSION_DIR}'"
  exit 1
fi

if [ "${SKIP_CONFIRM}" -ne 1 ]; then
  if [ ! -t 0 ]; then
    echo "[error] Non-interactive shell and no -y passed — refusing to quit Chrome unprompted."
    exit 1
  fi
  echo "Found browser: ${CHROME_BIN}"
  echo "This quits and relaunches it (--load-extension only takes effect on a fresh"
  echo "launch) — any open tabs/windows will close and reopen if Chrome is set to"
  echo "restore its session."
  read -r -p "Quit and relaunch it now to reload Ghost Writer? [y/N] " reply
  case "${reply}" in
    [yY]*) ;;
    *) echo "[info] Cancelled."; exit 0 ;;
  esac
fi

case "$(uname -s)" in
  Darwin)
    osascript -e "tell application \"$(basename "${CHROME_BIN}")\" to quit" 2>/dev/null || true
    wait_for_exit "$(basename "${CHROME_BIN}")"
    ;;
  Linux)
    pkill -TERM -f "${CHROME_BIN}" 2>/dev/null || true
    wait_for_exit "${CHROME_BIN}"
    ;;
esac

echo "[..] relaunching with the extension loaded"
nohup "${CHROME_BIN}" --load-extension="${EXTENSION_DIR}" >/dev/null 2>&1 &
disown || true
echo "[ok] Chrome relaunched with Ghost Writer loaded (id: ${EXTENSION_ID})"
