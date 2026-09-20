#!/usr/bin/env python3
"""Write ~/.ssh/id_ed25519 from PRODUCTION_SSH_KEY (PEM or base64, newlines optional)."""

import base64
import os
import pathlib
import textwrap


def main() -> None:
    raw = os.environ["SSH_PRIVATE_KEY"].strip().replace("\r", "")
    dest = pathlib.Path.home() / ".ssh" / "id_ed25519"
    dest.parent.mkdir(mode=0o700, exist_ok=True)
    if "BEGIN OPENSSH PRIVATE KEY" in raw:
        body = (
            raw.replace("-----BEGIN OPENSSH PRIVATE KEY-----", "")
            .replace("-----END OPENSSH PRIVATE KEY-----", "")
            .replace("\n", "")
            .replace(" ", "")
        )
        pem = ["-----BEGIN OPENSSH PRIVATE KEY-----"]
        pem.extend(textwrap.wrap(body, 70))
        pem.append("-----END OPENSSH PRIVATE KEY-----")
        dest.write_text("\n".join(pem) + "\n")
    else:
        dest.write_bytes(base64.b64decode(raw))
    dest.chmod(0o600)


if __name__ == "__main__":
    main()
