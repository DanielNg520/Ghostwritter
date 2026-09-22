"""Resolves a CLI binary's absolute path, working around Chrome's minimal
native-messaging PATH (missing ~/.local/bin, Homebrew, etc.) -- both
review_engine.py (agy/claude) and secrets_loader.py (sops) hit this same
problem since both run in a process Chrome spawns."""

import os
import shutil


def resolve_cli_path(binary_name, include_local_bin=True):
    found = shutil.which(binary_name)
    if found:
        return found
    candidates = []
    if include_local_bin:
        candidates.append(os.path.expanduser(f"~/.local/bin/{binary_name}"))
    candidates += [f"/opt/homebrew/bin/{binary_name}", f"/usr/local/bin/{binary_name}"]
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    return binary_name  # let the caller's subprocess raise a clear FileNotFoundError
