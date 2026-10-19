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

/** Every kind of refusal the till words, in one list (the type follows from it). */
export const POS_ERROR_KINDS = [
  "AUTHENTICATION_REQUIRED",
  "PERMISSION_DENIED",
  "CAPABILITY_NOT_ENABLED",
  "DEVICE_REVOKED",
  "SESSION_EXPIRED",
  "STALE_VERSION",
  "VALIDATION_ERROR",
  "BUSINESS_CONFLICT",
  "NOT_FOUND",
  "NO_APPROVER",
  "RATE_LIMITED",
  "SERVER_UNAVAILABLE",
  "NETWORK_ERROR",
  "RETRYABLE_INFRASTRUCTURE_ERROR",
  "UNKNOWN",
] as const;

export type PosErrorKind = (typeof POS_ERROR_KINDS)[number];

export interface PosError {
  kind: PosErrorKind;
  /** What happened, in one plain sentence. */
  sentence: string;
  /** What to do now, in one plain sentence. */
  nextStep: string;
  /** The sentence and the next step together: what the till shows. */
  message: string;
  /** The raw backend code, kept for logs/diagnostics only — never displayed. */
  code?: string;
  requestId?: string;
  retryable: boolean;
  /** RATE_LIMITED: how long Yetu asked the till to wait before the next attempt. */
  retryAfterSeconds?: number;
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
  RATE_LIMITED: "RATE_LIMITED",
  SERVICE_UNAVAILABLE: "SERVER_UNAVAILABLE",
  INTERNAL_ERROR: "RETRYABLE_INFRASTRUCTURE_ERROR",
  // fbc-peak #258: the owner has chosen nobody to approve this kind here.
  NO_APPROVER_SET: "NO_APPROVER",
  // S5b (fbc-peak #257, internal/pos/errors.go): each state conflict has a code of its own.
  ORDER_STATE_CHANGED: "BUSINESS_CONFLICT",
  ORDER_EMPTY: "BUSINESS_CONFLICT",
  ORDER_ALREADY_PAID: "BUSINESS_CONFLICT",
  ORDER_HAS_PAYMENT: "BUSINESS_CONFLICT",
  ORDER_ON_ANOTHER_SHIFT: "BUSINESS_CONFLICT",
  ITEM_NOT_REMOVABLE: "BUSINESS_CONFLICT",
  TICKET_STATE_CHANGED: "BUSINESS_CONFLICT",
  PRODUCT_UNAVAILABLE: "BUSINESS_CONFLICT",
  SHIFT_NOT_OPEN: "BUSINESS_CONFLICT",
  SHIFT_HAS_OPEN_ORDERS: "BUSINESS_CONFLICT",
  SHIFT_OFFLINE_CASH_UNRESOLVED: "BUSINESS_CONFLICT",
  SHIFT_FROM_EARLIER_DAY: "BUSINESS_CONFLICT",
  OFFLINE_SIGN_IN_REQUIRED: "BUSINESS_CONFLICT",
  FOLIO_NOT_OPEN: "BUSINESS_CONFLICT",
  PRINT_JOB_STATE_CHANGED: "BUSINESS_CONFLICT",
  TENDER_EXCEEDS_BALANCE: "VALIDATION_ERROR",
};

/** A code the till doesn't know yet, read by its status: what kind of refusal it can only be. */
const STATUS_TO_KIND: Record<number, PosErrorKind> = {
  409: "BUSINESS_CONFLICT",
  422: "VALIDATION_ERROR",
};

const CALL_SUPPORT = "Try again. If it keeps happening, call support.";

/** Each refusal in words: what happened, then what to do now. */
const WORDS: Record<PosErrorKind, { sentence: string; nextStep: string }> = {
  AUTHENTICATION_REQUIRED: { sentence: "You're not signed in on this till.", nextStep: "Enter your PIN to carry on." },
  PERMISSION_DENIED: { sentence: "Your role can't do that.", nextStep: "Ask a supervisor or manager to help." },
  CAPABILITY_NOT_ENABLED: { sentence: "This isn't switched on for your business.", nextStep: "Ask a manager to switch it on in Yetu." },
  DEVICE_REVOKED: { sentence: "This till was disconnected from your restaurant.", nextStep: "Ask a manager to connect it again." },
  SESSION_EXPIRED: { sentence: "You were signed out.", nextStep: "Enter your PIN to carry on." },
  STALE_VERSION: { sentence: "This order changed on another till. We've reloaded it.", nextStep: "Check it, then try again." },
  VALIDATION_ERROR: { sentence: "Some of the details aren't right.", nextStep: "Check them, then try again." },
  BUSINESS_CONFLICT: { sentence: "Yetu couldn't do that with things as they are now.", nextStep: "Check the order, then try again." },
  NOT_FOUND: { sentence: "Yetu can't find that any more. It may have changed on another till.", nextStep: "Go back to the list and open it again." },
  NO_APPROVER: { sentence: "No one is set to approve this here yet.", nextStep: "The owner chooses who approves in Team rules." },
  RATE_LIMITED: { sentence: "Too many attempts.", nextStep: "Wait a minute and try again." },
  SERVER_UNAVAILABLE: { sentence: "Yetu isn't answering right now.", nextStep: "Wait a moment, then try again." },
  NETWORK_ERROR: { sentence: "Can't reach Yetu.", nextStep: "Check the internet connection, then try again." },
  RETRYABLE_INFRASTRUCTURE_ERROR: { sentence: "Something went wrong at Yetu.", nextStep: CALL_SUPPORT },
  UNKNOWN: { sentence: "Something went wrong.", nextStep: CALL_SUPPORT },
};

const RETRYABLE: Set<PosErrorKind> = new Set([
  "RATE_LIMITED",
  "SERVER_UNAVAILABLE",
  "NETWORK_ERROR",
  "RETRYABLE_INFRASTRUCTURE_ERROR",
]);

/** Named setting: up to this wait, the words say "a minute"; past it they name the time. */
export const RATE_LIMIT_MINUTE_SECONDS = 60;

function clock(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** "Too many attempts." and when the next one is allowed. */
export function rateLimitWords(retryAfterSeconds: number | undefined, now: Date = new Date()): string {
  if (retryAfterSeconds === undefined || retryAfterSeconds <= RATE_LIMIT_MINUTE_SECONDS) {
    return `${WORDS.RATE_LIMITED.sentence} ${WORDS.RATE_LIMITED.nextStep}`;
  }
  return `${WORDS.RATE_LIMITED.sentence} Wait until ${clock(new Date(now.getTime() + retryAfterSeconds * 1000))} and try again.`;
}

/** The wait Yetu asked for: the Retry-After the transport kept, else its own sentence ("Try again in 31 seconds."). */
function retryAfterOf(problem: Problem & { retryAfterSeconds?: unknown }): number | undefined {
  if (typeof problem.retryAfterSeconds === "number" && Number.isFinite(problem.retryAfterSeconds)) return problem.retryAfterSeconds;
  const said = /in (\d+) seconds?/i.exec(problem.detail ?? "");
  return said ? Number(said[1]) : undefined;
}

function described(kind: PosErrorKind, extra: Partial<PosError> = {}, sentence = WORDS[kind].sentence, nextStep = WORDS[kind].nextStep): PosError {
  return { kind, sentence, nextStep, message: `${sentence} ${nextStep}`, retryable: RETRYABLE.has(kind), ...extra };
}

/** Parses whatever `ApiResult.error` holds (a Problem, a plain string, a thrown Error, or nothing). */
export function describePosError(error: unknown): PosError {
  if (error instanceof TypeError || /Failed to fetch|NetworkError|ECONNREFUSED/i.test(String(error))) {
    return described("NETWORK_ERROR");
  }
  const problem = isProblem(error)
    ? error
    : typeof error === "string"
      ? safeParseProblem(error)
      : undefined;
  if (problem?.code) {
    const kind = CODE_TO_KIND[problem.code] ?? (problem.status ? STATUS_TO_KIND[problem.status] : undefined) ?? "UNKNOWN";
    const extra = { code: problem.code, requestId: problem.request_id };
    if (kind === "RATE_LIMITED") {
      const retryAfterSeconds = retryAfterOf(problem);
      const words = rateLimitWords(retryAfterSeconds);
      return { ...described(kind, { ...extra, retryAfterSeconds }), nextStep: words.slice(WORDS.RATE_LIMITED.sentence.length + 1), message: words };
    }
    return described(kind, extra);
  }
  return described("UNKNOWN");
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
