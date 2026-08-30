/**
 * Coherent operational copy for the `httpx.Problem` codes fbc-peak actually
 * emits (`internal/platform/httpx/problem.go`) plus the client-local
 * conditions (network unreachable, malformed response). No SQLSTATE, no Go
 * error text, no stack trace, no raw API JSON ever reaches the till.
 */

export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  instance?: string;
  request_id?: string;
  details?: Record<string, unknown>;
}

export type PosErrorKind =
  | "AUTHENTICATION_REQUIRED"
  | "PERMISSION_DENIED"
  | "CAPABILITY_NOT_ENABLED"
  | "DEVICE_REVOKED"
  | "SESSION_EXPIRED"
  | "STALE_VERSION"
  | "VALIDATION_ERROR"
  | "BUSINESS_CONFLICT"
  | "NOT_FOUND"
  | "SERVER_UNAVAILABLE"
  | "NETWORK_ERROR"
  | "RETRYABLE_INFRASTRUCTURE_ERROR"
  | "UNKNOWN";

export interface PosError {
  kind: PosErrorKind;
  /** Short, calm, actionable copy safe to show on the till. */
  message: string;
  /** The raw backend code, kept for logs/diagnostics only — never displayed. */
  code?: string;
  requestId?: string;
  retryable: boolean;
}

function isProblem(value: unknown): value is Problem {
  return Boolean(value) && typeof value === "object" && ("code" in (value as object) || "title" in (value as object));
}

const CODE_TO_KIND: Record<string, PosErrorKind> = {
  UNAUTHENTICATED: "AUTHENTICATION_REQUIRED",
  FORBIDDEN: "PERMISSION_DENIED",
  CAPABILITY_NOT_ENABLED: "CAPABILITY_NOT_ENABLED",
  DEVICE_REVOKED: "DEVICE_REVOKED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  STALE_VERSION: "STALE_VERSION",
  VALIDATION_FAILED: "VALIDATION_ERROR",
  CONFLICT: "BUSINESS_CONFLICT",
  INVALID_STATE: "BUSINESS_CONFLICT",
  NOT_FOUND: "NOT_FOUND",
  SERVICE_UNAVAILABLE: "SERVER_UNAVAILABLE",
  INTERNAL_ERROR: "RETRYABLE_INFRASTRUCTURE_ERROR",
};

const MESSAGE: Record<PosErrorKind, string> = {
  AUTHENTICATION_REQUIRED: "Your session isn't signed in. Enter your PIN again.",
  PERMISSION_DENIED: "This staff account isn't authorized for that action. Ask a manager.",
  CAPABILITY_NOT_ENABLED: "This feature isn't enabled for this property.",
  DEVICE_REVOKED: "This register has been revoked. Ask a manager to pair this device again.",
  SESSION_EXPIRED: "Your session expired — enter your PIN again.",
  STALE_VERSION: "This order changed on another terminal. We've refreshed it.",
  VALIDATION_ERROR: "Check the details and try again.",
  BUSINESS_CONFLICT: "That can't be done right now. Refresh and try again.",
  NOT_FOUND: "That record could not be found. It may have changed on another terminal.",
  SERVER_UNAVAILABLE: "Peak is temporarily unavailable. Try again in a moment.",
  NETWORK_ERROR: "Can't reach Peak. Check the network and try again.",
  RETRYABLE_INFRASTRUCTURE_ERROR: "Something went wrong on Peak's end. Try again.",
  UNKNOWN: "Something went wrong. Try again.",
};

const RETRYABLE: Set<PosErrorKind> = new Set([
  "SERVER_UNAVAILABLE",
  "NETWORK_ERROR",
  "RETRYABLE_INFRASTRUCTURE_ERROR",
]);

/** Parses whatever `ApiResult.error` holds (a Problem, a plain string, a thrown Error, or nothing). */
export function describePosError(error: unknown): PosError {
  if (error instanceof TypeError || /Failed to fetch|NetworkError|ECONNREFUSED/i.test(String(error))) {
    return { kind: "NETWORK_ERROR", message: MESSAGE.NETWORK_ERROR, retryable: true };
  }
  const problem = isProblem(error)
    ? error
    : typeof error === "string"
      ? safeParseProblem(error)
      : undefined;
  if (problem?.code) {
    const kind = CODE_TO_KIND[problem.code] ?? "UNKNOWN";
    return {
      kind,
      message: problem.detail && kind === "VALIDATION_ERROR" ? problem.detail : MESSAGE[kind],
      code: problem.code,
      requestId: problem.request_id,
      retryable: RETRYABLE.has(kind),
    };
  }
  return { kind: "UNKNOWN", message: MESSAGE.UNKNOWN, retryable: false };
}

function safeParseProblem(text: string): Problem | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isProblem(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Convenience for UI code that only has a message string (e.g. a thrown Error). */
export function posErrorMessage(error: unknown): string {
  if (error instanceof Error) return describePosError(safeParseProblem(error.message) ?? error.message).message;
  return describePosError(error).message;
}
