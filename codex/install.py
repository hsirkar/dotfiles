#!/usr/bin/env python3
"""Merge portable Codex defaults without replacing machine-specific settings."""

import os
from pathlib import Path
import re
import shutil
import tempfile
import tomllib


def main():
    source = Path(__file__).with_name("config.toml").read_text()
    settings = tomllib.loads(source)
    config_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    target = config_home / "config.toml"
    original = target.read_text() if target.exists() else ""
    current = tomllib.loads(original)
    if all(current.get(key) == value for key, value in settings.items()):
        print(f"Codex approval settings already installed: {target}")
        return

    # Remove only managed top-level assignments; preserve all other text.
    lines = original.splitlines(keepends=True)
    root_end = next((i for i, line in enumerate(lines)
                     if line.lstrip().startswith("[")), len(lines))
    keys = "|".join(re.escape(key) for key in settings)
    assignment = re.compile(rf'^\s*(?:{keys}|"(?:{keys})"|\'(?:{keys})\')\s*=')
    root = "".join(line for line in lines[:root_end]
                   if not assignment.match(line))
    updated = source.rstrip() + "\n\n" + root + "".join(lines[root_end:])
    expected = current | settings
    if tomllib.loads(updated) != expected:
        raise ValueError("Refusing to modify config: unrelated settings would change")

    config_home.mkdir(parents=True, exist_ok=True)
    if target.exists():
        # Keep a unique backup of each changed config, including permissions.
        fd, backup = tempfile.mkstemp(prefix="config.toml.backup-", dir=config_home)
        os.close(fd)
        shutil.copy2(target, backup)
        print(f"Backed up Codex config: {backup}")
    fd, staged = tempfile.mkstemp(prefix=".config-", dir=config_home)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(updated)
        os.chmod(staged, target.stat().st_mode & 0o777 if target.exists() else 0o600)
        os.replace(staged, target)
    finally:
        if os.path.exists(staged):
            os.unlink(staged)
    print(f"Installed Codex approval settings: {target}")


if __name__ == "__main__":
    main()
