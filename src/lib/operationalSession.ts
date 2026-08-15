export interface OperationalSession {
  token: string;
  expiresAt: string;
  deviceId: string;
  propertyId: string;
  staffNumber: string;
  sessionClass?: string;
  tenantId?: string;
  userId?: string;
  outletId?: string;
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
