import { ChefHat, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button, EmptyState, Field, Money, SegmentedControl, StatusChip, TicketLine } from "../components/system";
import { formatMoney } from "../lib/money";
import type { POSOrder, POSOrderItem, ServiceType } from "../lib/posContracts";
import { clockTime, serviceTypeWords } from "../lib/words";

/** The order types the backend accepts (posContracts ServiceType), in this order. */
export const SERVICE_TYPES: readonly ServiceType[] = ["DINE_IN", "TAKEAWAY", "ROOM_SERVICE"];

/** Where the order goes, as free text until tables and rooms are picked from lists (S14). */
function labelFor(type: ServiceType): string | null {
  if (type === "DINE_IN") return "Table";
  if (type === "ROOM_SERVICE") return "Room";
  return null;
}

export interface TicketPanelProps {
  order: POSOrder | null;
  currency: string | undefined;
  serviceType: ServiceType;
  onServiceType: (type: ServiceType) => void;
  /** The table or room, typed before the order starts. */
  label: string;
  onLabel: (label: string) => void;
  selectedLineId: string | null;
  onSelectLine: (lineId: string | null) => void;
  onAddAnother: (line: POSOrderItem) => void;
  onRemoveLine: (line: POSOrderItem) => void;
  lineBusy: boolean;
  /** When this till sent the order to the kitchen, if it did. */
  sentAt: Date | null;
  error: string | null;
  /** Send to kitchen, Pay and More. */
  actions: ReactNode;
}

/**
 * The order ticket, always beside the menu: the order type and table or
 * room, the lines (quantity, name, options beneath, Yetu's price), the
 * selected line's actions, and the totals, every figure from Yetu.
 *
 * Yetu has no way to change a line's quantity or note: an unsent line can be
 * repeated (Add another) or removed; a sent line comes off only by voiding
 * the order with a supervisor.
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
  onAddAnother,
  onRemoveLine,
  lineBusy,
  sentAt,
  error,
  actions,
}: TicketPanelProps) {
  const locked = order !== null;
  const type = order?.serviceType ?? serviceType;
  const labelName = labelFor(type);
  const lines = (order?.items ?? []).filter((line) => line.status !== "VOIDED");
  const sent = order !== null && order.status !== "OPEN" && order.status !== "CLOSED" && order.status !== "VOIDED";

  return (
    <div className="y-ticket">
      <header className="y-ticket__head">
        <div className="y-ticket__title-row">
          <h2 className="y-ticket__title">{order ? `Order ${order.orderNumber}` : "New order"}</h2>
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
        {labelName ? (
          <Field
            label={labelName}
            value={locked ? (order?.tableLabel ?? "") : label}
            onChange={onLabel}
            hint={locked ? "Saved with the order." : undefined}
            disabled={locked}
            autoComplete="off"
            data-testid="table-label"
          />
        ) : null}
        {sent ? (
          <StatusChip tone="info" icon={<ChefHat aria-hidden="true" />} data-testid="ticket-sent">
            {sentAt ? `Sent to kitchen ${clockTime(sentAt)}` : "Sent to kitchen"}
          </StatusChip>
        ) : null}
      </header>

      <div className="y-ticket__lines" aria-label="Lines">
        {lines.length === 0 ? (
          <EmptyState title="Tap an item to start an order." />
        ) : (
          <ul className="y-ticket__list">
            {lines.map((line) => {
              const selected = line.id === selectedLineId;
              return (
                <li key={line.id} data-testid={`cart-${line.name}`}>
                  <TicketLine
                    quantity={line.quantity}
                    name={line.name}
                    options={(line.modifiers ?? []).map((modifier) => modifier.optionName)}
                    amount={formatMoney(line.totalMinor, currency)}
                    sent={line.status === "SENT"}
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
                          <Button icon={<Plus />} disabled={lineBusy} onClick={() => onAddAnother(line)}>
                            Add another
                          </Button>
                          <Button variant="danger" icon={<Trash2 />} disabled={lineBusy} onClick={() => onRemoveLine(line)}>
                            Remove
                          </Button>
                        </>
                      ) : (
                        <p className="y-ticket__line-note">
                          Sent to the kitchen. To take it off, void the order with a supervisor (More).
                        </p>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="y-ticket__foot">
        <dl className="y-ticket__totals" data-testid="ticket-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>
              <Money minor={order ? order.subtotalMinor : null} currency={currency} />
            </dd>
          </div>
          {order && order.discountMinor > 0 ? (
            <div>
              <dt>Discount{order.discountReason ? ` · ${order.discountReason}` : ""}</dt>
              <dd data-testid="cart-discount">
                <Money minor={-order.discountMinor} currency={currency} />
              </dd>
            </div>
          ) : null}
          <div>
            <dt>VAT</dt>
            <dd>
              <Money minor={order ? order.taxMinor : null} currency={currency} />
            </dd>
          </div>
          <div className="y-ticket__total">
            <dt>Total</dt>
            <dd data-testid="cart-preview-total">
              <Money minor={order && lines.length > 0 ? order.totalMinor : null} currency={currency} size="heading" />
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
          <p className="y-ticket__error" role="alert" data-testid="create-error">
            {error}
          </p>
        ) : null}
        {actions}
      </footer>
    </div>
  );
}
