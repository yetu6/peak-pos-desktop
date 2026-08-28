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
