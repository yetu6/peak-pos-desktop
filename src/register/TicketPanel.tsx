import { linesByRound } from "./rounds";
import { vatFigures } from "../lib/vatWords";
import { Ban, ChefHat, Trash2 } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Banner, Button, EmptyState, Field, Money, PermissionNotice, SegmentedControl, StatusChip, Stepper, TicketLine, type Refusal } from "../components/system";
import { formatMoney } from "../lib/money";
import type { POSOrder, POSOrderItem, ServiceType } from "../lib/posContracts";
import { MAX_LINE_QUANTITY } from "../lib/posContracts";
import { clockTime, orderPlaceWords, serviceTypeWords } from "../lib/words";
import { orderName } from "../lib/orderNumber";
import { ORDER_CONTEXT_WORDS, DISCOUNT_HELD_WORDS } from "./registerWords";

/** The order types the backend accepts (posContracts ServiceType), in this order. */
export const SERVICE_TYPES: readonly ServiceType[] = ["DINE_IN", "TAKEAWAY", "ROOM_SERVICE"];

/** Where the order goes, as free text until tables and rooms are picked from lists (S14). */
function labelFor(type: ServiceType, askForTable: boolean): string | null {
  if (!askForTable && type !== "ROOM_SERVICE") return ORDER_CONTEXT_WORDS.name;
  if (type === "DINE_IN") return "Table or name";
  if (type === "ROOM_SERVICE") return "Room";
  return null;
}

/** A tap still with Yetu (F-247). */
export interface WaitingTap {
  key: number;
  name: string;
}

export interface TicketPanelProps {
  askForTable?: boolean;
  captureGuestCount?: boolean;
  guestCount?: number;
  onGuestCount?: (count: number | undefined) => void;
  order: POSOrder | null;
  currency: string | undefined;
  serviceType: ServiceType;
  onServiceType: (type: ServiceType) => void;
  /** The table or room, typed before the order starts. */
  label: string;
  onLabel: (label: string) => void;
  selectedLineId: string | null;
  onSelectLine: (lineId: string | null) => void;
  /** How many of an unsent line (the stepper); Yetu prices it as it was added. */
  onQuantity: (line: POSOrderItem, quantity: number) => void;
  onRemoveLine: (line: POSOrderItem) => void;
  /** A sent line comes off with a supervisor (fbc-peak 00125); absent: the till can't void one. */
  onVoidLine?: (line: POSOrderItem) => void;
  /** Taps still with Yetu, shown at once as being added until Yetu's line takes their place (F-247). */
  waiting?: readonly WaitingTap[];
  lineBusy: boolean;
  /** When this till sent the order to the kitchen, if it did. */
  sentAt: Date | null;
  /** A refusal on the ticket: Yetu's 403 shows as a permission notice. */
  error: Refusal | string | null;
  /** Offered beside a refusal whose answer was lost: the same request again. */
  onRetry?: () => void;
  retrying?: boolean;
  /** What just happened, in words (an order voided). */
  notice?: string | null;
  /** Send to kitchen, Pay and More. */
  actions: ReactNode;
  /** What staff say about an item, by its product (the Restaurant & Bar module's tags). */
  tagsOf?: (productId: string) => string | undefined;
}

/**
 * The order ticket, always beside the menu: the order type and table or
 * room, the lines (quantity, name, options beneath, Yetu's price), the
 * selected line's actions, and the totals, every figure from Yetu.
 *
 * An unsent line's quantity goes up or down by its stepper (never below one:
 * Remove takes it off), at the price it was added at; a sent line, or some of
 * it, is voided with a supervisor before the bill is paid (the owner,
 * 2026-10-21), and refunded after.
 */
export function TicketPanel({
  order,
  currency,
  serviceType,
  onServiceType,
  label,
  onLabel,
  selectedLineId,
  onSelectLine,
  onQuantity,
  onRemoveLine,
  onVoidLine,
  waiting = [],
  lineBusy,
  sentAt,
  error,
  onRetry,
  retrying = false,
  notice = null,
  actions,
  tagsOf,
  askForTable = true,
  captureGuestCount = false,
  guestCount,
  onGuestCount,
}: TicketPanelProps) {
  const locked = order !== null;
  const type = order?.serviceType ?? serviceType;
  const labelName = labelFor(type, askForTable);
  const lines = (order?.items ?? []).filter((line) => line.status !== "VOIDED");
  // The figures as the guest reads them: with VAT inside the prices, the menu prices (F-229).
  const figures = order ? vatFigures(order) : null;
  // The newest line in view: the ticket scrolls to it as lines are added.
  const groupsRef = useRef<HTMLDivElement>(null);
  const lineCount = lines.length + waiting.length;
  useEffect(() => {
    const items = groupsRef.current?.querySelectorAll("li");
    const newest = items?.[items.length - 1];
    if (newest && typeof newest.scrollIntoView === "function") newest.scrollIntoView({ block: "nearest" });
  }, [lineCount]);
  // An order with no lines yet has no figures to show.
  const priced = figures !== null && lines.length > 0;

  function renderLine(line: POSOrderItem) {
    const selected = line.id === selectedLineId;
    return (
      <li key={line.id} data-testid={`cart-${line.name}`}>
        <TicketLine
          quantity={line.quantity}
          name={line.name}
          options={(line.modifiers ?? []).map((modifier) => modifier.optionName)}
          tags={tagsOf?.(line.productId)}
          amount={formatMoney(line.totalMinor, currency)}
          sent={line.status === "SENT"}
          sentChip={false}
          selected={selected}
          onSelect={() => onSelectLine(selected ? null : line.id)}
        />
        {selected ? (
          <div
            role="group"
            aria-label={line.name}
            className="y-ticket__line-actions"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onSelectLine(null);
              }
            }}
          >
            {line.status === "ADDED" ? (
              <>
                <Stepper label={line.name} value={line.quantity} min={1} max={MAX_LINE_QUANTITY} disabled={lineBusy} onChange={(quantity) => onQuantity(line, quantity)} />
                <Button variant="danger-outline" icon={<Trash2 />} disabled={lineBusy} onClick={() => onRemoveLine(line)}>
                  Remove
                </Button>
              </>
            ) : onVoidLine && order && order.paidMinor === 0 ? (
              <Button variant="danger-outline" icon={<Ban />} disabled={lineBusy} onClick={() => onVoidLine(line)} data-testid="void-line">
                Cancel item
              </Button>
            ) : (
              <p className="y-ticket__line-note">
                {order && order.paidMinor > 0
                  ? "Part of the bill is paid. Refund it after it is paid."
                  : "Sent. A supervisor can cancel it."}
              </p>
            )}
          </div>
        ) : null}
      </li>
    );
  }

  const sent = order !== null && order.status !== "OPEN" && order.status !== "CLOSED" && order.status !== "VOIDED";

  return (
    <div className="y-ticket">
      <header className="y-ticket__head">
        <div className="y-ticket__title-row">
          <h2 className="y-ticket__title">{order ? orderName(order) : "New order"}</h2>
          {order?.initiatedByName ? <span className="y-ticket__who">{order.initiatedByName}</span> : null}
        </div>
        <SegmentedControl
          label="Order type"
          value={type}
          onChange={onServiceType}
          options={SERVICE_TYPES.map((value) => ({ value, label: serviceTypeWords(value) }))}
          disabled={locked}
          testIdPrefix="service-type"
        />
        {locked ? (
          orderPlaceWords(type, order?.tableLabel, order?.askForTable ?? askForTable) ? (
            <p className="y-ticket__where" data-testid="table-label">
              {orderPlaceWords(type, order?.tableLabel, order?.askForTable ?? askForTable)}
              <span className="y-ticket__saved"> · Saved with the order.</span>
            </p>
          ) : null
        ) : labelName ? (
          <Field label={labelName} value={label} onChange={onLabel} autoComplete="off" data-testid="table-label" />
        ) : null}
        {!locked && type === "DINE_IN" && captureGuestCount && onGuestCount ? (
          <div><p className="y-ticket__who">{ORDER_CONTEXT_WORDS.guests}</p><Stepper label={ORDER_CONTEXT_WORDS.guests} value={guestCount ?? 0} min={0} max={2_147_483_647} onChange={(count) => onGuestCount(count > 0 ? count : undefined)} /></div>
        ) : order?.guestCount ? <p className="y-ticket__who">{ORDER_CONTEXT_WORDS.guestCount(order.guestCount)}</p> : null}
        {sent ? (
          <StatusChip tone="info" icon={<ChefHat aria-hidden="true" />} data-testid="ticket-sent">
            {sentAt ? `Sent ${clockTime(sentAt)}` : "Sent"}
          </StatusChip>
        ) : null}
      </header>

      <div className="y-ticket__lines" aria-label="Lines">
        {notice ? (
          <Banner inline tone="info" data-testid="ticket-notice">
            {notice}
          </Banner>
        ) : null}
        {lineCount === 0 ? (
          <EmptyState title="Tap an item to start an order." />
        ) : (
          <div className="y-ticket__groups" ref={groupsRef}>
            {linesByRound(lines).map((group) => (
              <section
                key={group.key}
                className="y-ticket__group"
                aria-label={group.title ?? undefined}
                data-testid={`ticket-group-${group.key}`}
              >
                {group.title ? (
                  <h3 className={group.key === "unsent" ? "y-ticket__group-title y-ticket__group-title--unsent" : "y-ticket__group-title"}>
                    {group.title}
                  </h3>
                ) : null}
                <ul className="y-ticket__list">{group.lines.map(renderLine)}</ul>
              </section>
            ))}
            {waiting.length > 0 ? (
              <ul className="y-ticket__list" aria-label="Being added" data-testid="ticket-waiting">
                {waiting.map((tap) => (
                  <li key={tap.key}>
                    <TicketLine quantity={1} name={tap.name} amount="Adding…" className="y-ticket-line--waiting" />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>

      <footer className="y-ticket__foot">
        <dl className="y-ticket__totals" data-testid="ticket-totals">
          <div>
            <dt>{figures?.itemsLabel ?? "Subtotal"}</dt>
            <dd>
              <Money minor={priced ? figures.itemsMinor : null} currency={currency} />
            </dd>
          </div>
          {order && figures && figures.discountMinor > 0 ? (
            <div>
              <dt>Discount{order.discountReason ? ` · ${order.discountReason}` : ""}</dt>
              <dd data-testid="cart-discount">
                <Money minor={-figures.discountMinor} currency={currency} />
              </dd>
            </div>
          ) : null}
          {order?.discountCapped && figures && figures.discountMinor > 0 ? (
            <div className="y-ticket__held-row">
              <dt className="sr-only">About the discount</dt>
              <dd className="y-ticket__held" data-testid="discount-held">
                {DISCOUNT_HELD_WORDS}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>{figures?.vatLabel ?? "VAT"}</dt>
            <dd>
              <Money minor={priced ? figures.taxMinor : null} currency={currency} />
            </dd>
          </div>
          <div className="y-ticket__total">
            <dt>Total</dt>
            <dd data-testid="cart-preview-total">
              <Money minor={priced && order ? order.totalMinor : null} currency={currency} size="heading" />
            </dd>
          </div>
          {order && order.paidMinor > 0 ? (
            <>
              <div>
                <dt>Paid</dt>
                <dd>
                  <Money minor={order.paidMinor} currency={currency} />
                </dd>
              </div>
              <div>
                <dt>Still to pay</dt>
                <dd data-testid="cart-remaining">
                  <Money minor={order.remainingMinor} currency={currency} />
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        {error ? (
          typeof error !== "string" && error.kind === "permission" ? (
            <div data-testid="create-error">
              <PermissionNotice live words={error.words} />
            </div>
          ) : (
            <div className="y-ticket__error-row" data-testid="create-error">
              <p className="y-ticket__error" role="alert">
                {typeof error === "string" ? error : error.words}
              </p>
              {onRetry ? (
                <Button variant="secondary" disabled={retrying} onClick={onRetry}>
                  {retrying ? "Trying again…" : "Try again"}
                </Button>
              ) : null}
            </div>
          )
        ) : null}
        {actions}
      </footer>
    </div>
  );
}
