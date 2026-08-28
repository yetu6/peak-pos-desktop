import { afterEach, describe, expect, it } from "vitest";
import {
  clearOperationalSession,
  getOperationalSession,
  setOperationalSession,
  type OperationalSession,
} from "./operationalSession";
import { hasBearerIdentity, restRequestHeaders, socketAlignedHeaders } from "./restAuth";

const env = {
  tenantId: "env-t",
  userId: "env-u",
  propertyId: "env-p",
  outletId: "env-o",
};

const complete: OperationalSession = {
  token: "ops_abc",
  expiresAt: "2026-08-16T05:00:00Z",
  tenantId: "t1",
  propertyId: "p1",
  outletId: "o1",
  terminalId: "d1",
  staffId: "u1",
  assurance: "RESTRICTED",
};

describe("restAuth", () => {
  afterEach(() => {
    clearOperationalSession();
  });

  it("uses the opaque restricted bearer instead of client-selected identity headers", () => {
    expect(hasBearerIdentity(complete)).toBe(true);
    const headers = restRequestHeaders(complete, env);
    expect(headers.Authorization).toBe("Bearer ops_abc");
    expect(headers["X-Peak-Tenant-Id"]).toBeUndefined();
  });

  it("sends Bearer ops token alone for a complete server session", () => {
    expect(hasBearerIdentity(complete)).toBe(true);
    const headers = restRequestHeaders(complete, env);
    expect(headers.Authorization).toBe("Bearer ops_abc");
    expect(headers["X-Peak-Tenant-Id"]).toBeUndefined();
    expect(headers["X-Peak-Tenant-User-Id"]).toBeUndefined();
  });

  it("aligns backfill with the socket: token XOR headers, never both", () => {
    const withToken = socketAlignedHeaders(complete, env);
    expect(withToken.Authorization).toBe("Bearer ops_abc");
    expect(withToken["X-Peak-Tenant-Id"]).toBeUndefined();

    const withoutToken = socketAlignedHeaders(null, env);
    expect(withoutToken.Authorization).toBeUndefined();
    expect(withoutToken["X-Peak-Tenant-Id"]).toBe("env-t");
  });

  it("never mixes Authorization with X-Peak identity headers", () => {
    for (const session of [null, complete]) {
      const rest = restRequestHeaders(session, env);
      const socket = socketAlignedHeaders(session, env);
      expect(Boolean(rest.Authorization) && Boolean(rest["X-Peak-Tenant-Id"])).toBe(false);
      expect(Boolean(socket.Authorization) && Boolean(socket["X-Peak-Tenant-Id"])).toBe(false);
    }
  });

  it("holds the current ops session for the API client", () => {
    setOperationalSession(complete);
    expect(getOperationalSession()?.token).toBe("ops_abc");
    clearOperationalSession();
    expect(getOperationalSession()).toBeNull();
  });
});
