export interface SignedAuthorizationBundle {
  kid: string;
  algorithm: "Ed25519";
  signatureVersion: 1;
  payloadB64: string;
  signatureB64: string;
}

export interface AuthorizationStageResult {
  state: "STAGED" | "ACTIVE";
  hardExpiresAt: number;
  staffCount: number;
  catalogVersion: string;
  catalogDigest: string;
  prerequisite: "CATALOG_REQUIRED" | null;
}

export interface TerminalBinding {
  terminalId: string;
  credentialEpoch: number;
  propertyId: string;
  outletId: string;
  registerId: string;
  trustKeyId: string;
  trustPublicKeyB64: string;
  configurationPayloadB64: string;
  revocationGeneration: number;
  pairedAtMs: number;
}

export interface SignedTerminalLifecycleEvent {
  keyId: string;
  payloadB64: string;
  signatureB64: string;
}

export interface OfflineAuthenticationResult {
  state:
    | "AUTHENTICATED"
    | "DENIED"
    | "LOCKED"
    | "EXPIRED"
    | "REVOKED"
    | "NOT_ELIGIBLE";
  staffId?: string;
  displayName?: string;
  shiftId?: string;
  leaseId?: string;
  expiresAtMs?: number;
  retryAfterMs?: number;
  terminalId?: string;
  propertyId?: string;
  outletId?: string;
  registerId?: string;
  permissions?: string[];
}

export interface OfflineEligibilityStatus {
  state:
    | "ELIGIBLE"
    | "BOOTSTRAP_REQUIRED"
    | "DEVICE_REVOKED"
    | "STORAGE_UNHEALTHY"
    | "LEASE_NOT_YET_VALID"
    | "LEASE_EXPIRED"
    | "CLOCK_ROLLBACK"
    | "SHIFT_REQUIRED"
    | "SHIFT_MISMATCH"
    | "CATALOG_REQUIRED"
    | "STAFF_REQUIRED"
    | "LIMIT_EXHAUSTED";
  leaseId?: string;
  shiftId?: string;
  catalogVersion?: string;
  hardExpiresAtMs?: number;
  operationCountRemaining?: number;
  grossRemainingMinor?: number;
  cashRemainingMinor?: number;
}

export interface OfflineAuthority {
  bindTerminal(binding: TerminalBinding): Promise<void>;
  applyLifecycleEvent(envelope: SignedTerminalLifecycleEvent): Promise<void>;
  stageAuthorization(envelope: SignedAuthorizationBundle): Promise<AuthorizationStageResult>;
  authenticateStaff(staffId: string, pin: string): Promise<OfflineAuthenticationResult>;
  staffRoster?(): Promise<Array<{staffId:string;displayName:string}>>;
  eligibilityStatus(staffId?: string): Promise<OfflineEligibilityStatus>;
  clearStaffSession(): Promise<void>;
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function createNativeOfflineAuthority(invoke: Invoke): OfflineAuthority {
  return {
    bindTerminal: (binding) =>
      invoke("bind_terminal_authority", { binding }) as Promise<void>,
    applyLifecycleEvent: (envelope) =>
      invoke("apply_terminal_lifecycle_event", { envelope }) as Promise<void>,
    stageAuthorization: (envelope) =>
      invoke("stage_offline_authorization", { envelope }) as Promise<AuthorizationStageResult>,
    authenticateStaff: (staffId, pin) =>
      invoke("authenticate_offline_staff", { staffId, pin }) as Promise<OfflineAuthenticationResult>,
    staffRoster: () => invoke("get_offline_staff_roster") as Promise<Array<{staffId:string;displayName:string}>>,
    eligibilityStatus: (staffId) =>
      invoke("offline_eligibility_status", { staffId }) as Promise<OfflineEligibilityStatus>,
    clearStaffSession: () => invoke("clear_active_staff_session") as Promise<void>,
  };
}

export async function loadNativeOfflineAuthority(): Promise<OfflineAuthority> {
  const { invoke } = await import("@tauri-apps/api/core");
  return createNativeOfflineAuthority(invoke);
}
