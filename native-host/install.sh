#!/usr/bin/env bash
# Installs the Ghost Writer native messaging host manifest for Chrome (or
# Chromium) on macOS or Linux. Run this once after loading the unpacked
# extension — and again on any new machine (Fedora box included), since the
# manifest embeds an absolute path to this repo's host.py.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

EXTENSION_ID="${1:-}"

if [ -z "${EXTENSION_ID}" ]; then
  echo "Usage: $0 <extension-id>"
  echo ""
  echo "  <extension-id> is the ID Chrome assigns this extension. Get it by"
  echo "  opening chrome://extensions, enabling Developer mode, loading the"
  echo "  'extension/' folder as an unpacked extension, and copying the ID"
  echo "  shown on its card. (Since extension/manifest.json pins a stable"
  echo "  \"key\", this ID stays the same across reloads and across"
  echo "  machines.) Alternatively, Chrome derives the ID from that key"
  echo "  field if you want to compute it yourself instead of reading it"
  echo "  from chrome://extensions."
  exit 1
fi

TEMPLATE_PATH="${SCRIPT_DIR}/com.ghostwriter.host.json.template"
HOST_PY_PATH="${SCRIPT_DIR}/host.py"

# Figure out where each installed Chromium-family browser expects native
# messaging host manifests, per-OS. We install into every target directory
# whose browser's config dir already exists, so e.g. having both Chrome and
# Chromium installed just works, and we don't create stray config dirs for
# browsers that aren't present.
declare -a TARGET_DIRS=()

case "$(uname -s)" in
  Darwin)
    TARGET_DIRS+=(
      "${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
      "${HOME}/Library/Application Support/Chromium/NativeMessagingHosts"
      "${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
      "${HOME}/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    )
    ;;
  Linux)
    TARGET_DIRS+=(
      "${HOME}/.config/google-chrome/NativeMessagingHosts"
      "${HOME}/.config/google-chrome-beta/NativeMessagingHosts"
      "${HOME}/.config/chromium/NativeMessagingHosts"
      "${HOME}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
      "${HOME}/.config/microsoft-edge/NativeMessagingHosts"
    )
    ;;
  *)
    echo "[error] Unsupported OS: $(uname -s). Use native-host/install.ps1 on Windows." >&2
    exit 1
    ;;
esac

chmod +x "${HOST_PY_PATH}"

# Always install into the primary (first-listed) browser dir for the OS, even
# if that browser isn't installed yet, so there's at least one manifest in
# place. Additionally install into any other browser dirs that already exist
# (i.e. that browser is actually installed).
INSTALLED_ANY=0
for i in "${!TARGET_DIRS[@]}"; do
  dir="${TARGET_DIRS[$i]}"
  if [ "$i" -eq 0 ] || [ -d "$(dirname "${dir}")" ]; then
    mkdir -p "${dir}"
    target_path="${dir}/com.ghostwriter.host.json"
    sed -e "s#__HOST_PY_PATH__#${HOST_PY_PATH}#g" \
        -e "s#__EXTENSION_ID__#${EXTENSION_ID}#g" \
        "${TEMPLATE_PATH}" > "${target_path}"
    echo "Installed native messaging host manifest:"
    echo "  ${target_path}"
    INSTALLED_ANY=1
  fi
done

if [ "${INSTALLED_ANY}" -eq 0 ]; then
  echo "[error] Could not find or create any browser config directory." >&2
  exit 1
fi

echo ""
echo "Pointing at host: ${HOST_PY_PATH}"
echo "Allowed extension ID: ${EXTENSION_ID}"
echo ""
echo "Reload the extension in chrome://extensions and try it out."
