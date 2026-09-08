#!/usr/bin/env bash
# Installs the Ghost Writer native messaging host manifest for Chrome on
# macOS. Run this once after loading the unpacked extension.
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
  echo "  \"key\", this ID stays the same across reloads.) Alternatively,"
  echo "  Chrome derives the ID from that key field if you want to compute"
  echo "  it yourself instead of reading it from chrome://extensions."
  exit 1
fi

TEMPLATE_PATH="${SCRIPT_DIR}/com.ghostwriter.host.json.template"
HOST_PY_PATH="${SCRIPT_DIR}/host.py"
TARGET_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
TARGET_PATH="${TARGET_DIR}/com.ghostwriter.host.json"

mkdir -p "${TARGET_DIR}"

sed -e "s#__HOST_PY_PATH__#${HOST_PY_PATH}#g" \
    -e "s#__EXTENSION_ID__#${EXTENSION_ID}#g" \
    "${TEMPLATE_PATH}" > "${TARGET_PATH}"

chmod +x "${HOST_PY_PATH}"

echo "Installed native messaging host manifest:"
echo "  ${TARGET_PATH}"
echo "Pointing at host: ${HOST_PY_PATH}"
echo "Allowed extension ID: ${EXTENSION_ID}"
echo ""
echo "Reload the extension in chrome://extensions and try it out."
