# Hosting Yetu POS downloads on the VPS

Manual installs only. This is **static file hosting**, not running the till
on the server.

## Layout

```
/var/www/yetu-downloads/pos/
  latest/
    Peak-Terminal_0.1.0_amd64.deb
    Peak-Terminal_0.1.0_x64_en-US.msi
    Peak-Terminal_0.1.0_aarch64.dmg   # or x64
    SHA256SUMS
  0.1.0/   # optional frozen copy of the same files
```

## Publish steps

1. Tag / run [`.github/workflows/release.yml`](../.github/workflows/release.yml).
2. Download the Release assets + `SHA256SUMS`.
3. Copy into `latest/` (and a versioned folder if you keep history).
4. Confirm Caddy/nginx serves the directory over HTTPS with directory listing
   disabled; link the folder or an `index.html` that lists OS installers.

## Hospitality Web

Set on the property-web deploy env:

```
NEXT_PUBLIC_POS_DOWNLOAD_URL=https://downloads.yetu.fbcsoftwares.com/pos/latest/
```

Rebuild/redeploy `peak-hospitality-web` so Registers & Devices shows the
download button.
