export function handshakeHeaders(input: {
  opsToken?: string | null;
  tenantId?: string | null;
  userId?: string | null;
}): Record<string, string> {
  const opsToken = input.opsToken || undefined;
  const tenantId = input.tenantId || undefined;
  const userId = input.userId || undefined;
  if (opsToken && (tenantId || userId)) {
    throw new Error(
      "PEAK_OPS_TOKEN cannot be combined with identity headers; Peak refuses both on one handshake",
    );
  }
  if (opsToken) {
    return {
      Authorization: `Bearer ${opsToken}`,
      Origin: "http://localhost:5173",
    };
  }
  if (!tenantId || !userId) {
    throw new Error(
      "VITE_PEAK_TENANT_ID and VITE_PEAK_USER_ID are required unless PEAK_OPS_TOKEN is set",
    );
  }
  return {
    "X-Peak-Tenant-Id": tenantId,
    "X-Peak-Tenant-User-Id": userId,
    Origin: "http://localhost:5173",
  };
}
