"""Loads default provider credentials from the sops/age-encrypted
config/secrets.enc.yaml, so OpenRouter/Groq keys don't have to be re-typed
into the extension's Settings page. Requires the `sops` binary and a usable
age key (SOPS_AGE_KEY_FILE or ~/.config/sops/age/keys.txt) able to decrypt
the recipient in .sops.yaml. Never logs decrypted values.

This is a convenience default only: the extension's own Settings page
values (chrome.storage, sent with every request) always take precedence
when non-empty — see review_engine.resolve_credentials().
"""

import json
import os
import subprocess
from pathlib import Path

from cli_path import resolve_cli_path

REPO_ROOT = Path(__file__).resolve().parent.parent
SECRETS_PATH = REPO_ROOT / "config" / "secrets.enc.yaml"
SOPS_CONFIG_PATH = REPO_ROOT / ".sops.yaml"
DEFAULT_AGE_KEY_FILE = Path.home() / ".config" / "sops" / "age" / "keys.txt"


def load_secrets():
    """Returns a dict of decrypted secrets, or {} if the encrypted file is
    missing or sops fails (e.g. no key on this machine) — callers treat
    missing entries as "no default configured", not a hard error."""
    if not SECRETS_PATH.exists():
        return {}

    # SOPS_AGE_KEY_FILE is normally exported by ~/.zshrc, which Chrome never
    # sources when it spawns the native-messaging host (and, transitively,
    # this managed server) — so `sops` can't find the age key and fails with
    # exit 128 under the extension even though it works fine from a shell.
    # Set it explicitly (without clobbering an already-set value) so
    # decryption works regardless of how this process was launched.
    env = dict(os.environ)
    env.setdefault("SOPS_AGE_KEY_FILE", str(DEFAULT_AGE_KEY_FILE))

    try:
        result = subprocess.run(
            [resolve_cli_path("sops", include_local_bin=False), "--config", str(SOPS_CONFIG_PATH), "-d", "--output-type", "json", str(SECRETS_PATH)],
            capture_output=True,
            text=True,
            check=True,
            stdin=subprocess.DEVNULL,
            timeout=15,
            env=env,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        print(f"  [warn] could not load config/secrets.enc.yaml ({exc}); provider defaults unavailable")
        return {}

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}
