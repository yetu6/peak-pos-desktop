export interface OperationalSession {
  token: string;
  expiresAt: string;
  tenantId: string;
  propertyId: string;
  outletId: string;
  terminalId: string;
  staffId: string;
  assurance: "RESTRICTED";
  mode?: string;
  terminalName?: string;
  /** This property's authoritative effective capabilities (R6A-C), e.g.
   *  ["CORE","POS"] or ["CORE","LODGING","POS"] — never derived from
   *  property_type. UX composition only; every mutation is still
   *  re-checked against this same authority server-side. Optional only so
   *  existing fixtures that predate R6A-C keep compiling; every real login
   *  populates it (falls back to `[]`, i.e. hides everything gated on it,
   *  when genuinely absent). */
  capabilities?: string[];
  /** This staff member's own "resource.action" POS grants at this
   *  property (R6A-C), e.g. "pos.payment.record". Deliberately excludes
   *  pos.order.void and the shift-close variance override, which a
   *  DIFFERENT supervisor authorizes with their own PIN at the moment
   *  they enter it — never hide those two using this list. */
  permissions?: string[];
}

let current: OperationalSession | null = null;

export function getOperationalSession(): OperationalSession | null {
  return current;
}

export function setOperationalSession(session: OperationalSession | null): void {
  current = session;
}

export function clearOperationalSession(): void {
  current = null;
}

export class SessionExpiredError extends Error {
  constructor(message = "Operational session expired") {
    super(message);
    this.name = "SessionExpiredError";
  }
}
