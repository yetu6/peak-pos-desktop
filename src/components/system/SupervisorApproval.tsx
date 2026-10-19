import { CircleCheck, CircleX, LoaderCircle, ShieldCheck } from "lucide-react";
import { PIN_LENGTH } from "../../access/accessSettings";
import { cn } from "../../lib/utils";
import { Button } from "./Button";
import { Banner } from "./containers";
import { Keypad, type KeypadKey } from "./Keypad";

export interface Supervisor {
  id: string;
  name: string;
  /** The person's role in words ("Supervisor", "Manager"), never a role code. */
  roleName?: string;
}

export type ApprovalStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "approved"; by: string }
  | { kind: "refused"; reason: string };

export interface SupervisorApprovalProps {
  /** What is being approved, in words: "Give back TSh 9,500 in cash for 1 × Chocolate tart". */
  request: string;
  supervisors: readonly Supervisor[];
  /** The person asking. They can't approve their own request. */
  requesterId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** How many PIN digits are in (the digits themselves never reach this component). */
  pinLength: number;
  onPinKey: (key: KeypadKey) => void;
  status: ApprovalStatus;
  onCancel: () => void;
  /** When the screen submits on its own once the PIN is complete, leave this out. */
  onApprove?: () => void;
  canApprove?: boolean;
  /** "inline" draws Cancel and Approve here; "none" when a sheet's footer holds them
   *  (SupervisorApprovalActions), so they stay in view while the sheet scrolls. */
  actions?: "inline" | "none";
  /** Test ids for the PIN keys: `${keyTestIdPrefix}-${key}`. */
  keyTestIdPrefix?: string;
  className?: string;
}

/** Cancel and Approve, for a sheet's footer. */
export function SupervisorApprovalActions({
  onCancel,
  onApprove,
  canApprove = false,
}: Pick<SupervisorApprovalProps, "onCancel" | "onApprove" | "canApprove">) {
  return (
    <div className="y-approval__actions">
      <Button variant="quiet" onClick={onCancel}>
        Cancel
      </Button>
      {onApprove ? (
        <Button variant="primary" size={64} disabled={!canApprove} onClick={onApprove} icon={<ShieldCheck />}>
          Approve
        </Button>
      ) : null}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Ask a supervisor: one shape everywhere a second person must approve
 * (discount, void, cash out, refund). It says what is being approved, lists
 * the supervisors, takes the chosen one's PIN, refuses self-approval in words
 * and shows the result. Presentational: the screen that uses it does the
 * checking with the backend.
 */
export function SupervisorApproval({
  request,
  supervisors,
  requesterId,
  selectedId,
  onSelect,
  pinLength,
  onPinKey,
  status,
  onCancel,
  onApprove,
  canApprove = false,
  actions = "inline",
  keyTestIdPrefix,
  className,
}: SupervisorApprovalProps) {
  const selected = supervisors.find((supervisor) => supervisor.id === selectedId) ?? null;
  const selfApproval = selected !== null && selected.id === requesterId;
  const settled = status.kind === "checking" || status.kind === "approved";
  const pinOpen = selected !== null && !selfApproval && !settled;

  return (
    <div className={cn("y-approval", className)}>
      <section className="y-approval__request" aria-labelledby="approval-request-heading">
        <h3 id="approval-request-heading" className="y-approval__label">
          What needs approval
        </h3>
        <p className="y-approval__request-text">{request}</p>
      </section>

      <section aria-labelledby="approval-who-heading">
        <h3 id="approval-who-heading" className="y-approval__label">
          Choose a supervisor
        </h3>
        {supervisors.length === 0 ? (
          <p className="y-approval__message">
            This till can't show its staff list right now, so no one can approve here. Check the internet connection,
            then try again.
          </p>
        ) : null}
        <div role="radiogroup" aria-labelledby="approval-who-heading" className="y-approval__people">
          {supervisors.map((supervisor) => {
            // The person asking is shown, marked You, and can't be chosen: they can't approve their own request.
            const isRequester = supervisor.id === requesterId;
            const reasonId = `approval-self-${supervisor.id}`;
            return (
              <button
                key={supervisor.id}
                type="button"
                role="radio"
                aria-checked={supervisor.id === selectedId}
                aria-describedby={isRequester ? reasonId : undefined}
                className={cn("y-approval__person", isRequester && "y-approval__person--self")}
                disabled={settled || isRequester}
                onClick={() => onSelect(supervisor.id)}
              >
                <span className="y-avatar" aria-hidden="true">
                  {initials(supervisor.name)}
                </span>
                <span className="y-approval__person-text">
                  <span className="y-approval__person-name">
                    {supervisor.name}
                    {isRequester ? <span className="y-approval__you">You</span> : null}
                  </span>
                  {isRequester ? (
                    <span id={reasonId} className="y-approval__person-role">
                      You can't approve your own request.
                    </span>
                  ) : supervisor.roleName ? (
                    <span className="y-approval__person-role">{supervisor.roleName}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {selfApproval ? (
        <p className="y-approval__message y-approval__message--danger" role="alert">
          <CircleX aria-hidden="true" />
          You can't approve your own request. Ask another supervisor.
        </p>
      ) : null}

      <section className="y-approval__pin" aria-labelledby="approval-pin-heading">
        <h3 id="approval-pin-heading" className="y-approval__pin-heading">
          {selected && !selfApproval ? `${selected.name}, enter your PIN` : "Choose a supervisor to continue"}
        </h3>
        <div
          className="y-pin-dots"
          data-testid="pin-dots"
          role="img"
          aria-label={`${pinLength} ${pinLength === 1 ? "digit" : "digits"} entered`}
        >
          {/* One dot for each digit of a PIN (F-242: it drew four for six). */}
          {Array.from({ length: Math.max(PIN_LENGTH, pinLength) }, (_, index) => (
            <span key={index} className={cn("y-pin-dots__dot", index < pinLength && "y-pin-dots__dot--filled")} />
          ))}
        </div>
        <Keypad label="Supervisor PIN" variant="pin" onKey={onPinKey} disabled={!pinOpen} testIdPrefix={keyTestIdPrefix} />
      </section>

      {status.kind === "checking" ? (
        <p className="y-approval__message" role="status">
          <LoaderCircle className="y-spin" aria-hidden="true" />
          Checking the PIN
        </p>
      ) : null}
      {status.kind === "approved" ? (
        <p className="y-approval__message y-approval__message--success" role="status">
          <CircleCheck aria-hidden="true" />
          Approved by {status.by}
        </p>
      ) : null}
      {status.kind === "refused" ? (
        <p className="y-approval__message y-approval__message--danger" role="alert">
          <CircleX aria-hidden="true" />
          {status.reason}
        </p>
      ) : null}

      {actions === "inline" ? (
        <SupervisorApprovalActions onCancel={onCancel} onApprove={onApprove} canApprove={canApprove && pinOpen} />
      ) : null}
    </div>
  );
}

/** Who can do this and what to do now, instead of a refusal with no way forward. */
export function PermissionNotice({
  action,
  who,
  next,
  words,
  live = false,
  className,
}: {
  /** What the person tried, as a verb phrase: "void orders". */
  action?: string;
  /** Who can: "a supervisor", "a manager". */
  who?: string;
  /** What to do now: "Ask one to help." */
  next?: string;
  /** The whole notice in words, when a screen's words module already wrote it. */
  words?: string;
  /** Yetu just refused it (a 403): announced at once, as a failure. Otherwise a quiet note. */
  live?: boolean;
  className?: string;
}) {
  return (
    <p role={live ? "alert" : "note"} className={cn("y-permission", className)}>
      <ShieldCheck aria-hidden="true" />
      <span>{words ?? `Only ${who} can ${action}. ${next}`}</span>
    </p>
  );
}

/** A refusal as the screens' words modules give it: what kind, and the words. */
export interface Refusal {
  kind: string;
  words: string;
}

/**
 * A refusal on screen: a permission refusal (Yetu's 403) as a PermissionNotice,
 * anything else as a danger notice, both announced at once. `onRetry` offers
 * Try again beside it (the same request, after a lost answer).
 */
export function RefusalNotice({
  refusal,
  onRetry,
  retrying = false,
  className,
  "data-testid": testId,
}: {
  refusal: Refusal | string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  "data-testid"?: string;
}) {
  const { kind, words } = typeof refusal === "string" ? { kind: "other", words: refusal } : refusal;
  if (kind === "permission") {
    return (
      <div className={className} data-testid={testId}>
        <PermissionNotice live words={words} />
      </div>
    );
  }
  return (
    <div className={cn("y-refusal", className)} data-testid={testId}>
      <Banner
        inline
        tone="danger"
        action={
          onRetry ? (
            <Button variant="secondary" disabled={retrying} onClick={onRetry}>
              {retrying ? "Trying again…" : "Try again"}
            </Button>
          ) : undefined
        }
      >
        {words}
      </Banner>
    </div>
  );
}
