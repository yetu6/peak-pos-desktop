import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// What release.yml stages for 0.1.4: the real file names a Tauri release makes.
const FILES = [
  "Yetu_0.1.4_x64-setup.exe",
  "Yetu_0.1.4_x64_en-US.msi",
  "Yetu_0.1.4_x64_en-US.msi.sig",
  "Yetu_0.1.4_aarch64.dmg",
  "Yetu.app.tar.gz",
  "Yetu.app.tar.gz.sig",
  "Yetu_0.1.4_amd64.AppImage",
  "Yetu_0.1.4_amd64.AppImage.sig",
  "Yetu_0.1.4_amd64.deb",
  "Yetu-0.1.4-1.x86_64.rpm",
  "yetu-icon.png",
];
const BASE = "https://downloads.yetu.fbcsoftwares.com/pos/0.1.4";
const MANIFEST = {
  version: "0.1.4",
  pub_date: "2026-10-22T23:42:33Z",
  platforms: {
    "windows-x86_64": { url: `${BASE}/Yetu_0.1.4_x64_en-US.msi`, signature: "sig" },
    "linux-x86_64": { url: `${BASE}/Yetu_0.1.4_amd64.AppImage`, signature: "sig" },
    "darwin-aarch64": { url: `${BASE}/Yetu.app.tar.gz`, signature: "sig" },
  },
};

let work = "";
let root = "";
let stage = "";

function publish(): { status: number | null; stderr: string } {
  const run = spawnSync("sh", ["scripts/publish-downloads.sh"], {
    env: { ...process.env, PEAK_POS_VERSION: "v0.1.4", PEAK_POS_STAGE_DIR: stage, PEAK_POS_DOWNLOADS_ROOT: join(root, "pos") },
    encoding: "utf8",
  });
  return { status: run.status, stderr: run.stderr };
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "yetu-downloads-"));
  root = join(work, "site");
  stage = join(work, "stage");
  mkdirSync(join(root, "pos"), { recursive: true });
  mkdirSync(stage);
  for (const name of FILES) writeFileSync(join(stage, name), `bytes of ${name}`);
  writeFileSync(join(stage, "latest.json"), JSON.stringify(MANIFEST));
  execFileSync("sh", ["-c", 'cd "$1" && sha256sum -- * > SHA256SUMS', "sh", stage]);
});

afterEach(() => rmSync(work, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("the downloads page (the bare address showed nothing)", () => {
  it("a release publishes a page people can download from, with the version in words", () => {
    expect(publish().status).toBe(0);
    const page = readFileSync(join(root, "index.html"), "utf8");
    expect(page).toContain("<title>Download Yetu</title>");
    expect(page).toContain("Version 0.1.4, released Fri 23 Oct 2026.");
    expect(page).toContain('<img src="pos/0.1.4/yetu-icon.png"');
    // The main button is the .msi: Windows tills update with it (latest.json), so a till
    // installed from the page is never left with a second copy after its first update.
    expect(page).toMatch(/class="primary" href="pos\/0\.1\.4\/Yetu_0\.1\.4_x64_en-US\.msi">Download for Windows</);
    expect(page).not.toContain("x64-setup.exe");
    for (const name of ["Yetu_0.1.4_aarch64.dmg", "Yetu_0.1.4_amd64.AppImage", "Yetu_0.1.4_amd64.deb", "Yetu-0.1.4-1.x86_64.rpm", "SHA256SUMS"]) {
      expect(page).toContain(`href="pos/0.1.4/${encodeURIComponent(name)}"`);
    }
    // Updater files are for the tills, not for people.
    expect(page).not.toMatch(/\.sig"|\.tar\.gz"|latest\.json"/);
    expect(page).toContain("Yetu updates itself.");
    expect(page).toContain("Get a code, then a manager types it in Yetu.");
  });

  it("a release that fails its checksums publishes nothing, page included", () => {
    writeFileSync(join(stage, "Yetu_0.1.4_x64-setup.exe"), "tampered");
    const result = publish();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/did NOT match/);
    expect(existsSync(join(root, "index.html"))).toBe(false);
    expect(existsSync(join(root, "pos", "0.1.4"))).toBe(false);
  });
});
