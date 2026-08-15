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

const incomplete: OperationalSession = {
  token: "ops_abc",
  expiresAt: "2026-08-16T05:00:00Z",
  deviceId: "d1",
  propertyId: "p1",
  staffNumber: "0007",
};

const complete: OperationalSession = {
  ...incomplete,
  tenantId: "t1",
  userId: "u1",
  outletId: "o1",
};

describe("restAuth", () => {
  afterEach(() => {
    clearOperationalSession();
  });

  it("keeps header identity when Peak login omits tenant/user/outlet", () => {
    expect(hasBearerIdentity(incomplete)).toBe(false);
    const headers = restRequestHeaders(incomplete, env);
    expect(headers.Authorization).toBeUndefined();
    expect(headers["X-Peak-Tenant-Id"]).toBe("env-t");
    expect(headers["X-Peak-Tenant-User-Id"]).toBe("env-u");
  });

  it("sends Bearer ops token alone when login includes tenant, user, and property", () => {
    expect(hasBearerIdentity({ ...complete, outletId: undefined })).toBe(true);
    const headers = restRequestHeaders({ ...complete, outletId: undefined }, env);
    expect(headers.Authorization).toBe("Bearer ops_abc");
    expect(headers["X-Peak-Tenant-Id"]).toBeUndefined();
    expect(headers["X-Peak-Tenant-User-Id"]).toBeUndefined();
  });

  it("aligns backfill with the socket: token XOR headers, never both", () => {
    const withToken = socketAlignedHeaders(incomplete, env);
    expect(withToken.Authorization).toBe("Bearer ops_abc");
    expect(withToken["X-Peak-Tenant-Id"]).toBeUndefined();

    const withoutToken = socketAlignedHeaders(null, env);
    expect(withoutToken.Authorization).toBeUndefined();
    expect(withoutToken["X-Peak-Tenant-Id"]).toBe("env-t");
  });

  it("never mixes Authorization with X-Peak identity headers", () => {
    for (const session of [null, incomplete, complete]) {
      const rest = restRequestHeaders(session, env);
      const socket = socketAlignedHeaders(session, env);
      expect(Boolean(rest.Authorization) && Boolean(rest["X-Peak-Tenant-Id"])).toBe(false);
      expect(Boolean(socket.Authorization) && Boolean(socket["X-Peak-Tenant-Id"])).toBe(false);
    }
  });

  it("holds the current ops session for the API client", () => {
    setOperationalSession(incomplete);
    expect(getOperationalSession()?.token).toBe("ops_abc");
    clearOperationalSession();
    expect(getOperationalSession()).toBeNull();
  });
});
