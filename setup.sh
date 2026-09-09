#!/usr/bin/env bash
# One-shot setup for Ghost Writer: creates the venv, installs Python
# dependencies, scaffolds personal config files, installs the Chrome
# native-messaging host, and (optionally) loads the extension into Chrome
# automatically. Safe to re-run any time, on any machine (macOS or Linux) —
# e.g. after unzipping this repo onto a fresh box.
#
# Usage:
#   ./setup.sh                     # everything, including auto-detecting the extension ID
#   ./setup.sh <extension-id>      # override the auto-detected ID (e.g. a re-keyed fork)
#   ./setup.sh --no-chrome         # skip the "quit & relaunch Chrome" step
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

LOAD_CHROME=1
EXTENSION_ID=""
for arg in "$@"; do
  case "${arg}" in
    --no-chrome) LOAD_CHROME=0 ;;
    *) EXTENSION_ID="${arg}" ;;
  esac
done

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

# ── Extension ID ──────────────────────────────────────────────────────────
# extension/manifest.json pins a fixed RSA "key", which makes Chrome's
# derived extension ID deterministic — the same on every machine. We can
# compute it ourselves (same algorithm Chrome uses: sha256 of the decoded
# key, first 16 bytes, each hex nibble mapped to a-p) instead of asking you
# to copy it out of chrome://extensions.
if [ -z "${EXTENSION_ID}" ]; then
  EXTENSION_ID="$("${PYTHON_BIN}" - <<'PYEOF'
import base64, hashlib, json
manifest = json.load(open("extension/manifest.json"))
key_bytes = base64.b64decode(manifest["key"])
digest = hashlib.sha256(key_bytes).hexdigest()
print("".join(chr(int(c, 16) + ord("a")) for c in digest[:32]))
PYEOF
  )"
  echo "[ok] extension ID (derived from manifest.json's pinned key): ${EXTENSION_ID}"
fi

# ── Native messaging host ────────────────────────────────────────────────────
echo ""
./native-host/install.sh "${EXTENSION_ID}"

# ── Load the extension into Chrome ───────────────────────────────────────────
echo ""
EXTENSION_DIR="${SCRIPT_DIR}/extension"

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

if [ "${LOAD_CHROME}" -eq 1 ]; then
  CHROME_BIN="$(find_chrome_binary || true)"
  if [ -z "${CHROME_BIN}" ]; then
    echo "[info] No Chrome/Chromium/Brave/Edge binary found — load the extension manually:"
    echo "  chrome://extensions -> enable Developer mode -> Load unpacked -> '${EXTENSION_DIR}'"
  elif [ ! -t 0 ]; then
    echo "[info] Non-interactive shell — skipping Chrome auto-load."
    echo "  Run ./setup.sh in a terminal to be offered it, or load it manually:"
    echo "  chrome://extensions -> enable Developer mode -> Load unpacked -> '${EXTENSION_DIR}'"
  else
    echo "Found browser: ${CHROME_BIN}"
    echo "Auto-loading the extension needs to quit and relaunch it (--load-extension"
    echo "only takes effect on a fresh launch) — any open tabs/windows will close and"
    echo "reopen if the browser is set to restore its session."
    read -r -p "Quit and relaunch it now to load Ghost Writer automatically? [y/N] " reply
    case "${reply}" in
      [yY]*)
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
        ;;
      *)
        echo "[info] Skipped. Load it manually whenever you like:"
        echo "  chrome://extensions -> enable Developer mode -> Load unpacked -> '${EXTENSION_DIR}'"
        ;;
    esac
  fi
else
  echo "[info] --no-chrome passed — skipping Chrome auto-load. Load it manually:"
  echo "  chrome://extensions -> enable Developer mode -> Load unpacked -> '${EXTENSION_DIR}'"
fi

echo ""
echo "Setup complete."
