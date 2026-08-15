export function opsTokenBridgeOrigin(bridgeUrl: string): string {
  const url = new URL(bridgeUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}

export async function applyOpsTokenToBridge(
  token: string,
  bridgeUrl: string,
): Promise<void> {
  const origin = opsTokenBridgeOrigin(bridgeUrl);
  const response = await fetch(`${origin}/ops-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    throw new Error(`Bridge refused ops token with HTTP ${response.status}`);
  }
}
