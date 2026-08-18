import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function connectSrcTokens(): string[] {
  const conf = JSON.parse(
    readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
  ) as { app: { security: { csp: string } } };
  const connect = conf.app.security.csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("connect-src"));
  if (!connect) throw new Error("connect-src directive missing");
  return connect.split(/\s+/);
}

describe("Tauri CSP", () => {
  it("matches Peak URL policy: HTTPS hotels, HTTP only on localhost", () => {
    const tokens = connectSrcTokens();
    expect(tokens).not.toContain("http:");
    expect(tokens).not.toContain("ws:");
    expect(tokens).toContain("https:");
    expect(tokens).toContain("wss:");
    expect(tokens).toContain("http://localhost:8080");
    expect(tokens).toContain("ipc:");
  });
});
