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

export interface SignInKitStore {
  /** Verifies the server's signature and replaces the whole kit; refuses a bad, foreign or older kit. */
  install(kit: SignedSignInKit): Promise<KitSummary>;
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

export function createNativeSignInKit(invoke: Invoke): SignInKitStore {
  return {
    install: (kit) =>
      invoke("install_sign_in_kit", {
        signedKit: kit.signedKit,
        signature: kit.signature,
        keyId: kit.keyId,
      }) as Promise<KitSummary>,
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
