#!/usr/bin/env python3
"""Write ~/.ssh/id_ed25519 from PRODUCTION_SSH_KEY (PEM text or base64)."""

import base64
import os
import pathlib


def main() -> None:
    raw = os.environ["SSH_PRIVATE_KEY"].strip().replace("\r", "")
    dest = pathlib.Path.home() / ".ssh" / "id_ed25519"
    dest.parent.mkdir(mode=0o700, exist_ok=True)
    if "BEGIN OPENSSH PRIVATE KEY" in raw or "BEGIN RSA PRIVATE KEY" in raw:
        # Keep PEM bytes intact. Rewrapping the body corrupts some keys and
        # makes ssh-keygen treat them as passphrase-protected garbage.
        if not raw.endswith("\n"):
            raw += "\n"
        dest.write_text(raw)
    else:
        dest.write_bytes(base64.b64decode(raw))
    dest.chmod(0o600)


if __name__ == "__main__":
    main()
