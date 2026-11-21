/**
 * The till's sign-in kit: everyone on this till's PIN screen with a till copy of
 * their PIN, kept encrypted in the native store. A PIN is checked there, in
 * hundredths of a second. Rust: src-tauri/src/local_store/sign_in_kit.rs.
 */

export interface SignInStaff {
  staffId: string;
  displayName: string;
  roleCode: string;
  permissions: string[];
}

export interface SignInTerminal {
  mode: string;
  prepStations: unknown;
  propertyName: string;
  outletName: string;
  terminalName: string;
  capabilities: unknown;
}

export interface KitSummary {
  terminalId: string;
  issuedAtMs: number;
  /** After this the kit checks nobody and the till signs in with the server. */
  expiresAtMs: number;
  staffCount: number;
}

/** What the native store answers. */
export type NativeSignInCheck =
  | { state: "OK"; staff: SignInStaff; terminal: SignInTerminal }
  | { state: "WRONG"; attemptsLeft: number }
  | { state: "LOCKED"; untilMs: number }
  | { state: "NO_COPY" }
  | { state: "UNKNOWN" };

/** The same answer as a typed result the sign-in screen can switch on. */
export type SignInResult =
  | { kind: "ok"; staff: SignInStaff; terminal: SignInTerminal }
  | { kind: "wrong"; attemptsLeft: number }
  | { kind: "locked"; untilMs: number }
  | { kind: "no-copy" }
  | { kind: "unknown" };

export interface SignedSignInKit {
  signedKit: string;
  signature: string;
  keyId: string;
}

/**
 * What installing a kit came to. A kit the till refuses is an answer, not a
 * crash: "rollback" is a kit older than one the till already held (a stale or
 * replayed answer), "refused" is any other kit it will not take (bad signature,
 * another terminal or pairing, expired, too long-lived, an untrusted key, or a
 * clock it cannot trust). Anything else is the store itself failing and throws.
 */
export type InstallResult =
  | { kind: "installed"; summary: KitSummary }
  | { kind: "rollback" }
  | { kind: "refused"; reason: string };

export interface SignInKitStore {
  /** Verifies the server's signature and replaces the whole kit; says why when it will not. */
  install(kit: SignedSignInKit): Promise<InstallResult>;
  /**
   * A fresh single-use nonce for the next kit request, made and remembered by
   * the till (never chosen in JS). A kit that answers it sets the till's clock.
   */
  newNonce(): Promise<string>;
  /** Checks a PIN against the kit. Never throws for a wrong PIN. */
  verify(staffId: string, pin: string): Promise<SignInResult>;
  /** Forgets the kit: every later check is "unknown". */
  clear(): Promise<void>;
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function mapSignInCheck(check: NativeSignInCheck): SignInResult {
  switch (check?.state) {
    case "OK":
      return { kind: "ok", staff: check.staff, terminal: check.terminal };
    case "WRONG":
      return { kind: "wrong", attemptsLeft: check.attemptsLeft };
    case "LOCKED":
      return { kind: "locked", untilMs: check.untilMs };
    case "NO_COPY":
      return { kind: "no-copy" };
    case "UNKNOWN":
      return { kind: "unknown" };
    default:
      throw new Error("The till's sign-in check gave an answer this version does not know.");
  }
}

/** The kinds the native store refuses a kit with, other than a rollback. */
const REFUSALS = new Set([
  "INVALID_AUTHORIZATION",
  "AUTHORIZATION_REQUIRED",
  "AUTHORIZATION_ROLLBACK",
]);

function refusalKind(error: unknown): string | null {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : null;
  const match = text ? /^[A-Z][A-Z_]+$/.exec(text.trim()) : null;
  return match ? match[0] : null;
}

export function createNativeSignInKit(invoke: Invoke): SignInKitStore {
  return {
    install: async (kit) => {
      try {
        const summary = (await invoke("install_sign_in_kit", {
          signedKit: kit.signedKit,
          signature: kit.signature,
          keyId: kit.keyId,
        })) as KitSummary;
        return { kind: "installed", summary };
      } catch (error) {
        const kind = refusalKind(error);
        if (kind === "KIT_ROLLBACK") return { kind: "rollback" };
        if (kind && REFUSALS.has(kind)) return { kind: "refused", reason: kind };
        throw error;
      }
    },
    newNonce: async () => (await invoke("new_sign_in_kit_nonce")) as string,
    verify: async (staffId, pin) =>
      mapSignInCheck((await invoke("verify_sign_in_pin", { staffId, pin })) as NativeSignInCheck),
    clear: async () => {
      await invoke("clear_sign_in_kit");
    },
  };
}

export async function loadNativeSignInKit(): Promise<SignInKitStore> {
  const { invoke } = await import("@tauri-apps/api/core");
  return createNativeSignInKit(invoke);
}

export interface SignInKitRequest {
  baseUrl: string;
  terminalId: string;
  deviceCredential: string;
}

export type FetchedSignInKit =
  | { kind: "kit"; kit: SignedSignInKit }
  /** 401: Yetu no longer knows this till (revoked, unpaired, or a bad credential). */
  | { kind: "not-paired" };

type YetuFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Asks Yetu for this till's sign-in kit: POST /api/v1/pos/device/sign-in-kit
 * with `{terminalId, deviceCredential, nonce}`. The nonce comes from the native
 * store (`store.newNonce()`), never from here, and the request goes through the
 * native Yetu client, which sends only to this till's own Yetu.
 */
export async function fetchSignInKit(
  store: Pick<SignInKitStore, "newNonce">,
  request: SignInKitRequest,
  send: YetuFetch,
): Promise<FetchedSignInKit> {
  const nonce = await store.newNonce();
  const response = await send(`${request.baseUrl}/api/v1/pos/device/sign-in-kit`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      terminalId: request.terminalId,
      deviceCredential: request.deviceCredential,
      nonce,
    }),
  });
  if (response.status === 401) return { kind: "not-paired" };
  if (!response.ok) throw new Error(`The sign-in kit failed with HTTP ${response.status}`);
  const body = (await response.json()) as Partial<SignedSignInKit>;
  if (!body?.signedKit || !body.signature || !body.keyId) {
    throw new Error("The sign-in kit came back incomplete");
  }
  return { kind: "kit", kit: { signedKit: body.signedKit, signature: body.signature, keyId: body.keyId } };
}
