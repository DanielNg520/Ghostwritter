#!/usr/bin/env python3
"""Ghost Writer native messaging host.

Chrome spawns this script (via chrome.runtime.connectNative) and talks to it
over stdin/stdout using the native messaging protocol: each message is a
4-byte little-endian uint32 giving the byte length of a UTF-8 JSON payload,
followed by that many bytes, in both directions.

Responsibility of this script is intentionally narrow: on start, make sure
the local Ghost Writer server (server/server.py) is running, spawning it
--managed if it isn't, then reply {"status": "ready"}. After that it just
blocks reading stdin until EOF (Chrome closes the pipe when the extension
disconnects the port) and exits.

Design choice: we check/start the server on the very first message received
(rather than immediately on process start) — this guarantees we only touch
stdin/stdout inside the same read loop and keeps the "first contact" moment
explicit. Either timing is fine per the spec; this is just the one chosen
here.

IMPORTANT SIMPLIFICATION: each chrome.runtime.connectNative() call spawns a
brand new instance of this script with no memory of any other instance. So
there is no reliable way for one host.py process to know "is some other
connection still using the server?" on disconnect. Rather than build
cross-process coordination (a pidfile, a lock, etc.) for that, we don't try:
this host's job is ONLY to auto-start the server on demand. Shutdown is
handled entirely by the managed server process itself, which self-terminates
after IDLE_TIMEOUT_SECONDS of no HTTP activity (see server/server.py's
--managed idle watchdog, Phase 2 of docs/plan_v2_generalist.md). So on EOF,
host.py simply exits cleanly without attempting to kill anything.
"""

import json
import os
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_PATH = os.path.join(REPO_ROOT, "server", "server.py")
VENV_PYTHON = os.path.join(REPO_ROOT, ".venv", "bin", "python")
HEALTH_URL = "http://127.0.0.1:8000/health"

STARTUP_POLL_INTERVAL_SECONDS = 0.3
STARTUP_POLL_TIMEOUT_SECONDS = 10
HEALTH_CHECK_TIMEOUT_SECONDS = 1


def _python_executable():
    """Resolve the interpreter to run server.py with: prefer the repo's
    .venv (where review_engine's dependencies are installed), else fall
    back to whatever interpreter is running this host script."""
    if os.path.exists(VENV_PYTHON):
        return VENV_PYTHON
    return sys.executable


def read_message():
    """Read one length-prefixed native message from stdin. Returns the
    parsed JSON object, or None on EOF."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length or len(raw_length) < 4:
        return None
    message_length = struct.unpack("<I", raw_length)[0]
    raw_message = b""
    while len(raw_message) < message_length:
        chunk = sys.stdin.buffer.read(message_length - len(raw_message))
        if not chunk:
            return None
        raw_message += chunk
    return json.loads(raw_message.decode("utf-8"))


def send_message(obj):
    """Write one length-prefixed native message to stdout."""
    encoded = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def is_server_healthy():
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=HEALTH_CHECK_TIMEOUT_SECONDS) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def spawn_server():
    python_exe = _python_executable()
    subprocess.Popen(
        [python_exe, SERVER_PATH, "--managed"],
        cwd=os.path.dirname(SERVER_PATH),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,  # detach: survives this host process exiting
    )


def ensure_server_running():
    """Returns True once the server responds to /health, False if it never
    comes up within the startup timeout."""
    if is_server_healthy():
        return True

    spawn_server()

    deadline = time.time() + STARTUP_POLL_TIMEOUT_SECONDS
    while time.time() < deadline:
        if is_server_healthy():
            return True
        time.sleep(STARTUP_POLL_INTERVAL_SECONDS)
    return is_server_healthy()


def main():
    try:
        ready = ensure_server_running()
        if ready:
            send_message({"status": "ready"})
        else:
            send_message({
                "status": "error",
                "message": "server did not become healthy within timeout",
            })
    except Exception as exc:  # noqa: BLE001 - report any failure, never crash silently
        try:
            send_message({"status": "error", "message": str(exc)})
        except Exception:
            pass

    # Block reading further messages/EOF. We don't act on message content
    # (there's nothing else for this host to do) or on EOF (see module
    # docstring: shutdown is the managed server's own idle timer's job).
    while True:
        message = read_message()
        if message is None:
            # EOF: Chrome closed stdin because the extension disconnected
            # the native port. Simplification (see module docstring): we do
            # NOT wait/grace-period + try to kill the managed server here —
            # there's nothing useful to do with a wait since this process
            # holds no state about other connections, and killing is the
            # managed server's own idle-timer's job. Just exit cleanly.
            sys.exit(0)


if __name__ == "__main__":
    main()
