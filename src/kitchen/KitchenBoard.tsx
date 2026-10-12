import { ChefHat, Clock } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { Banner, Button, EmptyState, PermissionNotice, SegmentedControl, Skeleton, StatusChip, type Choice } from "../components/system";
import { clockTime, orderPlaceWords, serviceTypeWords } from "../lib/words";
import { KITCHEN_REFRESH_SECONDS } from "./kitchenSettings";
import { boardColumns, type BoardColumn, type BoardTicket } from "./kitchenTickets";
import { isNewTicket, nextStepFor, stationWords, ticketAge, type AgeThresholds } from "./kitchenWords";

export interface KitchenBoardProps {
  /** "Kitchen" or "Bar". */
  title: string;
  /** The stations this screen shows, in words, when it is set to some. */
  stationsWords?: string;
  tickets: readonly BoardTicket[];
  /** The time the ages are worked out from. */
  nowMs: number;
  /** Tickets whose step is on its way to Yetu. */
  busyIds: ReadonlySet<string>;
  /** The person may move tickets on (pos.order.send). */
  canMove: boolean;
  onNextStep: (ticket: BoardTicket) => void;
  /** What the last step did, in words. */
  result?: string | null;
  /** Why the last step was refused, in words. */
  problem?: string | null;
  loading?: boolean;
  failed?: boolean;
  stationFilter?: { options: readonly Choice<string>[]; value: string; onChange: (value: string) => void } | null;
  thresholds?: AgeThresholds;
}

function placeWords(ticket: BoardTicket): string {
  return orderPlaceWords(ticket.serviceType, ticket.tableLabel) || serviceTypeWords(ticket.serviceType);
}

function countWords(count: number): string {
  return `${count} ${count === 1 ? "ticket" : "tickets"}`;
}

/**
 * The arrow keys move between the tickets' next steps: up and down within a
 * column, left and right to the nearest ticket in the next column. Only a
 * step button's own keys are taken; Space and Enter still press it.
 */
function moveBetweenSteps(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  const columns = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-kitchen-column]")).map((column) =>
    Array.from(column.querySelectorAll<HTMLButtonElement>("[data-kitchen-next]")),
  );
  const col = columns.findIndex((buttons) => buttons.includes(target as HTMLButtonElement));
  if (col < 0) return;
  const row = columns[col].indexOf(target as HTMLButtonElement);
  let next: HTMLButtonElement | undefined;
  if (event.key === "ArrowDown") next = columns[col][row + 1];
  else if (event.key === "ArrowUp") next = columns[col][row - 1];
  else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    const step = event.key === "ArrowRight" ? 1 : -1;
    for (let other = col + step; other >= 0 && other < columns.length; other += step) {
      if (columns[other].length > 0) {
        next = columns[other][Math.min(row, columns[other].length - 1)];
        break;
      }
    }
  } else return;
  event.preventDefault();
  next?.focus();
}

/**
 * The kitchen or bar board: New, Preparing and Ready, each with its count.
 * A ticket shows where the order goes, who took it, when it was sent and its
 * age in words and minutes, the items in large type with their options and
 * the order's note picked out, and one large next step. A ticket nobody has
 * started carries the orange New marker for its first moments.
 */
export function KitchenBoard({
  title,
  stationsWords,
  tickets,
  nowMs,
  busyIds,
  canMove,
  onNextStep,
  result = null,
  problem = null,
  loading = false,
  failed = false,
  stationFilter = null,
  thresholds,
}: KitchenBoardProps) {
  const columns = boardColumns(tickets);
  const empty = tickets.length === 0;
  const columnsRef = useRef<HTMLDivElement>(null);
  // The step a keyboard user was on: a step that moves its ticket to another
  // column (or off the board) takes its button away, and focus with it.
  const lastStep = useRef<{ id: string; column: string; row: number } | null>(null);

  function rememberStep(event: FocusEvent<HTMLDivElement>) {
    const step = event.target as HTMLElement;
    if (!step.hasAttribute("data-kitchen-next")) return;
    const column = step.closest<HTMLElement>("[data-kitchen-column]");
    const steps = column ? Array.from(column.querySelectorAll("[data-kitchen-next]")) : [];
    lastStep.current = { id: step.dataset.ticketId ?? "", column: column?.dataset.kitchenColumn ?? "", row: steps.indexOf(step) };
  }

  // Focus that goes anywhere else on the page is the person's own choice: let it be.
  useEffect(() => {
    function onFocusIn(event: globalThis.FocusEvent) {
      const target = event.target as HTMLElement | null;
      if (!target?.hasAttribute?.("data-kitchen-next") || !columnsRef.current?.contains(target)) lastStep.current = null;
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // When the step that had focus is gone, focus goes to the same ticket's new
  // step, or to the ticket now in its place in that column (the one above if
  // it was last), so the arrow keys and Enter carry on from there.
  useLayoutEffect(() => {
    const last = lastStep.current;
    const board = columnsRef.current;
    if (!last || !board) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const same = Array.from(board.querySelectorAll<HTMLButtonElement>("[data-kitchen-next]")).find((step) => step.dataset.ticketId === last.id);
    const column = board.querySelector<HTMLElement>(`[data-kitchen-column="${last.column}"]`);
    const inColumn = column ? Array.from(column.querySelectorAll<HTMLButtonElement>("[data-kitchen-next]")) : [];
    const next = same ?? inColumn[Math.min(last.row, inColumn.length - 1)] ?? board.querySelector<HTMLButtonElement>("[data-kitchen-next]");
    next?.focus();
  });

  return (
    <div className="y-kitchen" data-testid="kitchen-board">
      <div className="y-kitchen__top">
        <header className="y-kitchen__head">
          <div className="y-kitchen__titles">
            <h1 className="y-kitchen__title">{title}</h1>
            {stationsWords ? <p className="y-kitchen__stations">{stationsWords}</p> : null}
          </div>
          {stationFilter ? (
            <SegmentedControl
              label="Station"
              options={stationFilter.options}
              value={stationFilter.value}
              onChange={stationFilter.onChange}
              testIdPrefix="kitchen-station"
            />
          ) : null}
          <p className="y-kitchen__result" role="status" data-testid="kitchen-result">
            {result ?? ""}
          </p>
        </header>

        {!canMove ? (
          <PermissionNotice who="kitchen and waiting staff" action="move tickets on" next="Ask a manager." />
        ) : null}
        {problem ? (
          <Banner inline tone="danger" data-testid="kitchen-error">
            {problem}
          </Banner>
        ) : null}
        {failed ? (
          <Banner inline tone="danger" data-testid="kitchen-load-error">
            {`The tickets couldn't be loaded. Check the connection. The screen tries again every ${KITCHEN_REFRESH_SECONDS} seconds.`}
          </Banner>
        ) : null}
      </div>

      {loading ? (
        <div className="y-kitchen__columns" aria-label="Loading the tickets" role="group">
          {[0, 1, 2].map((index) => (
            <div key={index} className="y-kcol">
              <Skeleton height={28} width="40%" />
              <Skeleton height={220} radius="card" />
            </div>
          ))}
        </div>
      ) : (
        <div ref={columnsRef} className="y-kitchen__columns" onKeyDown={moveBetweenSteps} onFocus={rememberStep}>
          {columns.map((column) => (
            <Column
              key={column.status}
              column={column}
              empty={empty}
              nowMs={nowMs}
              busyIds={busyIds}
              canMove={canMove}
              onNextStep={onNextStep}
              thresholds={thresholds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Column({
  column,
  empty,
  nowMs,
  busyIds,
  canMove,
  onNextStep,
  thresholds,
}: {
  column: BoardColumn;
  /** The whole board is empty: the New column says so. */
  empty: boolean;
  nowMs: number;
  busyIds: ReadonlySet<string>;
  canMove: boolean;
  onNextStep: (ticket: BoardTicket) => void;
  thresholds?: AgeThresholds;
}) {
  const count = column.tickets.length;
  return (
    <section
      className="y-kcol"
      aria-label={`${column.title}, ${countWords(count)}`}
      data-kitchen-column={column.status}
      data-testid={`kitchen-column-${column.status}`}
    >
      <h2 className="y-kcol__head" aria-hidden="true">
        <span>{column.title}</span>
        <span className="y-kcol__count">{count}</span>
      </h2>
      <div className="y-kcol__body">
        {count === 0 ? (
          empty && column.status === "SENT" ? (
            <EmptyState
              icon={<ChefHat />}
              title="No orders waiting"
              description="New orders appear here as soon as they are sent."
            />
          ) : (
            <p className="y-kcol__none">{column.status === "SENT" ? "Nothing new" : "None"}</p>
          )
        ) : (
          column.tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              nowMs={nowMs}
              busy={busyIds.has(ticket.id)}
              canMove={canMove}
              onNextStep={onNextStep}
              thresholds={thresholds}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TicketCard({
  ticket,
  nowMs,
  busy,
  canMove,
  onNextStep,
  thresholds,
}: {
  ticket: BoardTicket;
  nowMs: number;
  busy: boolean;
  canMove: boolean;
  onNextStep: (ticket: BoardTicket) => void;
  thresholds?: AgeThresholds;
}) {
  const headingId = useId();
  const age = ticketAge(ticket.sentAt, nowMs, thresholds);
  const fresh = isNewTicket(ticket.status, ticket.sentAt, nowMs);
  const next = nextStepFor(ticket.status);
  const sent = ticket.sentAt ? clockTime(ticket.sentAt) : "";
  const meta = [placeWords(ticket), ticket.staffName, sent ? `Sent ${sent}` : "", ticket.station ? stationWords(ticket.station) : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={`y-kticket y-kticket--${age.tone}${fresh ? " y-kticket--new" : ""}`}
      aria-labelledby={headingId}
      data-testid={`kitchen-ticket-${ticket.id}`}
    >
      <header className="y-kticket__head">
        <h3 id={headingId} className="y-kticket__number">
          {ticket.orderNumber}
        </h3>
        {fresh ? (
          <StatusChip tone="accent" className="y-kticket__new">
            New
          </StatusChip>
        ) : null}
        <StatusChip tone={age.tone} icon={<Clock aria-hidden="true" />} className="y-kticket__age" data-testid={`kitchen-age-${ticket.id}`}>
          {age.words}
        </StatusChip>
      </header>
      <p className="y-kticket__meta">{meta}</p>
      <ul className="y-kticket__items">
        {ticket.items.map((item) => (
          <li key={item.id} className="y-kticket__item">
            <span className="y-kticket__qty">{item.quantity}</span>
            <span className="y-kticket__what">
              <span className="y-kticket__name">{item.name}</span>
              {(item.modifiers ?? []).map((modifier) => (
                <span key={modifier.id} className="y-kticket__option" data-testid="kitchen-option">
                  {modifier.optionName}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {ticket.notes?.trim() ? (
        <p className="y-kticket__note" data-testid={`kitchen-note-${ticket.id}`}>
          <strong>Note:</strong> {ticket.notes.trim()}
        </p>
      ) : null}
      {next ? (
        <Button
          variant="primary"
          size={64}
          block
          className="y-kticket__next"
          data-kitchen-next=""
          data-ticket-id={ticket.id}
          data-testid={`kitchen-next-${ticket.id}`}
          aria-label={`${busy ? next.pendingWords : next.words} order ${ticket.orderNumber}`}
          // While the step is with Yetu the button keeps its focus (not the native disabled); the click is ignored.
          aria-disabled={busy || undefined}
          disabled={!canMove}
          onClick={() => {
            if (!busy && canMove) onNextStep(ticket);
          }}
        >
          {busy ? next.pendingWords : next.words}
        </Button>
      ) : null}
    </article>
  );
}
