import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { FIXTURE_PATH, LIVE_API_URL } from "./liveSettings";

/** The ids and PINs cmd/e2e-seed prints for one property. */
export interface SeededProperty {
  organizationId: string;
  propertyId: string;
  outletId: string;
  ownerEmail: string;
  /** The F&B Manager's own sign-in (cmd/e2e-seed): who runs the menus, as in real life. */
  managerEmail: string;
  managerStaffId: string;
  managerPin: string;
  cashierStaffId: string;
  cashierPin: string;
  productId: string;
  extrasGroupId: string;
  cheeseOptionId: string;
}

export function loadSeededProperty(): SeededProperty {
  if (!FIXTURE_PATH) {
    throw new Error("Set PEAK_JOURNEY_MAMA_ROSE to the fixture tests/e2e-live/live-api.sh seed wrote");
  }
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as SeededProperty;
}

/**
 * The person who approves the till in Hospitality Web, signed in for real
 * with fbc-peak's local dev-login (mounted only with sign-in through ZITADEL
 * off): a genuine session cookie and CSRF token, as the journey uses. Since
 * migration 00084 only an organization-scope role signs in on the web, so this
 * is the owner, who holds pos_terminal.pair.
 */
export class WebSession {
  protected cookies = new Map<string, string>();
  protected csrf = "";

  protected keep(response: Response): void {
    for (const entry of response.headers.getSetCookie()) {
      const [pair] = entry.split(";");
      const at = pair.indexOf("=");
      if (at > 0) this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }

  async signIn(email: string): Promise<void> {
    const response = await fetch(`${LIVE_API_URL}/auth/dev-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    this.keep(response);
    const body = (await response.json()) as { csrfToken?: string };
    if (!response.ok || !body.csrfToken) {
      throw new Error(`dev-login for ${email}: HTTP ${response.status} ${JSON.stringify(body)}`);
    }
    this.csrf = body.csrfToken;
  }

  async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${LIVE_API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: Array.from(this.cookies, ([key, value]) => `${key}=${value}`).join("; "),
        "X-Peak-CSRF": this.csrf,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    this.keep(response);
    const text = await response.text();
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> HTTP ${response.status}: ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

export interface CatalogProduct {
  id: string;
  code: string;
  name: string;
  priceMinor: number;
}

/**
 * A second dish with no options, so the sale has one item with options and
 * one without. cmd/e2e-seed makes only House Special (with Extras); the
 * owner adds this one through the property's own catalog API, once.
 */
export async function ensurePlainDish(web: WebSession, seeded: SeededProperty): Promise<CatalogProduct> {
  const base = `/api/v1/organizations/${seeded.organizationId}/properties/${seeded.propertyId}`;
  const listed = await web.call<{ items: CatalogProduct[] }>(`${base}/products?outletId=${seeded.outletId}`);
  const existing = listed.items.find((product) => product.code === PLAIN_DISH.code);
  if (existing) return existing;
  return web.call<CatalogProduct>(`${base}/products`, { method: "POST", body: { outletId: seeded.outletId, ...PLAIN_DISH } });
}

/**
 * The owner chooses who approves at the till, as in Team rules (fbc-peak #258): since then a new business has
 * nobody chosen for any kind (void, refund, discount, cash out, a shift's cash difference), and the till is told
 * "No one is set to approve … here yet". cmd/e2e-seed makes a new business, so the owner allows the seeded
 * manager's role (`roleCode`) to approve every kind at the seeded property, through Yetu's own route.
 */
export async function chooseApprovers(web: WebSession, seeded: SeededProperty, roleCode: string): Promise<string[]> {
  const path = `/api/v1/organizations/${seeded.organizationId}/team-rules/approvals`;
  const rules = await web.call<{ kinds: Array<{ code: string }> }>(path);
  for (const kind of rules.kinds) {
    await web.call(path, { method: "PUT", body: { approvalKind: kind.code, roleCode, propertyId: seeded.propertyId, allowed: true } });
  }
  const after = await web.call<{ policies: Array<{ approvalKind: string; roleCode: string; propertyId: string | null; allowed: boolean }> }>(path);
  return rules.kinds
    .map((kind) => kind.code)
    .filter((code) => after.policies.some((policy) => policy.approvalKind === code && policy.roleCode === roleCode && policy.allowed));
}

/** The seeded manager's role (cmd/e2e-seed: FNB_MANAGER at the seeded property). */
export const SEEDED_MANAGER_ROLE = "FNB_MANAGER";

/** The plain dish's own settings: a code, a name and a price (minor units) with 18% VAT. */
export const PLAIN_DISH = { code: "CHIPS", name: "Chips", priceMinor: 500_000, taxRateBp: 1800 } as const;

/**
 * Money as the till writes it (TSh, en-GB digit groups, no decimals for a
 * whole amount), written out here on its own rather than borrowed from the
 * till's formatter, so a formatter fault shows as a mismatch.
 */
export function tsh(minor: number): string {
  const whole = Math.abs(minor) % 100 === 0;
  const digits = new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(Math.abs(minor) / 100);
  return `${minor < 0 ? "−" : ""}TSh ${digits}`;
}

/** What a person types into a money field for an amount: major units. */
export function typed(minor: number): string {
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

/**
 * A person signed in on a property's desk computer with their PIN, as staff
 * who run a property sign in on the web since fbc-peak 00084 (the F&B
 * Manager, the GM): the computer is paired with its own key, the owner
 * approves it under Property → Sign-in devices, and the person signs in on
 * it. The same steps as fbc-peak's cmd/loadtest-desk, through Yetu's routes.
 */
export class DeskSession extends WebSession {
  /**
   * `pin` is the person's PIN, or their setup code: then `newPin` is the PIN
   * they choose on this first sign-in (the desk asks for it, as the till
   * does). Desk and till share the one PIN.
   */
  async signInAtDesk(
    owner: WebSession, seeded: SeededProperty, staffId: string, pin: string, deviceName: string, newPin?: string,
  ): Promise<void> {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const begun = await deskCall<{ pairingRequestId: string; pairingCode: string; claimToken: string }>(
      "/api/v1/desk/pairing-requests", { publicKey: spki });
    await owner.call(`/api/v1/organizations/${seeded.organizationId}/properties/${seeded.propertyId}/desk-devices`, {
      method: "POST", body: { pairingCode: begun.pairingCode, name: deviceName },
    });
    const status = await fetch(`${LIVE_API_URL}/api/v1/desk/pairing-requests/${begun.pairingRequestId}`, {
      headers: { "X-Peak-Pairing-Token": begun.claimToken },
    }).then((r) => r.json() as Promise<{ status: string; deviceId?: string }>);
    if (status.status !== "APPROVED" || !status.deviceId) throw new Error(`the desk was not approved: ${JSON.stringify(status)}`);
    const challenge = await deskCall<{ challengeId: string; nonce: string }>("/api/v1/desk/challenges", { deviceId: status.deviceId });
    const signature = signNonce(privateKey, challenge.nonce);
    const response = await fetch(`${LIVE_API_URL}/api/v1/desk/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: challenge.challengeId, signature, staffId, pin, ...(newPin ? { newPin } : {}) }),
    });
    this.keep(response);
    if (response.status !== 201) throw new Error(`desk sign-in: HTTP ${response.status} ${await response.text()}`);
    const csrf = [...this.cookies].find(([name]) => name.toLowerCase().includes("csrf"));
    if (!csrf) throw new Error("the desk sign-in set no CSRF cookie");
    this.csrf = decodeURIComponent(csrf[1]);
  }
}

async function deskCall<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${LIVE_API_URL}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${path} -> HTTP ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

/** The device's answer to a challenge: ECDSA P-256 over SHA-256 of the nonce, r||s, base64url (as cmd/loadtest-desk). */
function signNonce(privateKey: KeyObject, nonceB64Url: string): string {
  const nonce = Buffer.from(nonceB64Url, "base64url");
  return sign("sha256", nonce, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
}

/** A six-digit PIN nobody could guess: not one digit repeated, not a run up or down. */
export function choosePin(): string {
  for (;;) {
    const digits = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte % 10);
    const steps = new Set(digits.slice(1).map((digit, i) => digit - digits[i]));
    if (!(steps.size === 1 && [0, 1, -1].includes([...steps][0]))) return digits.join("");
  }
}
