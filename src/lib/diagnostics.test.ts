import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildTechnicianSnapshot,
  packagedAppVersion,
  probePeakServer,
  snapshotContainsSecrets,
} from "./diagnostics";

function versions(): { npm: string; tauri: string; crate: string } {
  const root = process.cwd();
  const npm = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string })
    .version;
  const tauri = (
    JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const crateMatch = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8").match(
    /^version\s*=\s*"([^"]+)"/m,
  );
  return { npm, tauri, crate: crateMatch?.[1] ?? "" };
}

describe("diagnostics", () => {
  it("reads the packaged version, not a placeholder", () => {
    const { npm, tauri, crate } = versions();
    expect(npm).toMatch(/^\d+\.\d+\.\d+/);
    expect(npm).toBe(tauri);
    expect(npm).toBe(crate);
    expect(packagedAppVersion()).toBe(npm);
    expect(packagedAppVersion()).not.toMatch(/placeholder|todo|dev-local/i);
  });

  // Support must tell the hotel's internet from a problem at Yetu (2026-10-20): a
  // 502 from Yetu's front door, or Yetu without its database, is Yetu answering
  // with a problem, not the till being unable to reach it.
  it("asks Yetu whether it is ready, not for its front page", async () => {
    let asked = "";
    await probePeakServer("https://hotel.example/", async (url) => {
      asked = String(url);
      return { ok: true, status: 200 } as Response;
    });
    expect(asked).toBe("https://hotel.example/health/ready");
  });

  it("a ready answer is Yetu answering", async () => {
    const probe = await probePeakServer("https://hotel.example", async () => ({ ok: true, status: 200 }) as Response);
    expect(probe.status).toBe("reachable");
    expect(probe.detail).toBe("HTTP 200");
    expect(probe.origin).toBe("https://hotel.example");
  });

  it("any other answer is Yetu with a problem, and says which", async () => {
    for (const status of [503, 502, 404]) {
      const probe = await probePeakServer("https://hotel.example", async () => ({ ok: false, status }) as Response);
      expect(probe.status).toBe("failing");
      expect(probe.detail).toBe(`HTTP ${status}`);
    }
  });

  it("marks Peak unreachable when the address does not answer", async () => {
    const probe = await probePeakServer("https://hotel.example", async () => {
      throw new Error("Failed to fetch");
    });
    expect(probe.status).toBe("unreachable");
    expect(probe.detail).toBe("Failed to fetch");
  });

  it("never puts private keys or ops tokens on the technician snapshot", () => {
    const snapshot = buildTechnicianSnapshot({
      identity: {
        privateKeyPkcs8: "SECRET_PRIVATE_KEY",
        publicKeySpki: "public-material",
        deviceCode: "TILL-204",
        mode: "POS",
        terminalName: "Bar 1",
      },
      session: {
        token: "ops_SUPERSECRET",
        expiresAt: "2099-01-01T00:00:00Z",
        tenantId: "tenant-1",
        propertyId: "property-1",
        outletId: "outlet-1",
        terminalId: "device-uuid",
        staffId: "staff-12",
        assurance: "RESTRICTED",
      },
      host: { os: "linux", arch: "x86_64", appVersion: "0.1.0" },
      printer: { available: true, name: "front-bar" },
      keyStorage: { hardwareBacked: true, backend: "keyring", warning: null },
      peakOrigin: "https://hotel.example/",
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("SECRET_PRIVATE_KEY");
    expect(serialized).not.toContain("ops_SUPERSECRET");
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toMatch(/"token"/);
    expect(snapshotContainsSecrets(snapshot)).toBe(false);
    expect(snapshot.deviceCode).toBe("TILL-204");
    expect(snapshot.deviceId).toBe("device-uuid");
    expect(snapshot.appVersion).toBe("0.1.0");
    expect(snapshot.peakOrigin).toBe("https://hotel.example");
  });
});

describe("probePeakServer fetch wiring", () => {
  it("does not send authorization headers", async () => {
    let init: RequestInit | undefined;
    await probePeakServer("http://localhost:8080", async (_url, requestInit) => {
      init = requestInit;
      return { ok: true, status: 200 } as Response;
    });
    expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/authorization|ops_/i);
  });
});
