import { Banknote, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, EmptyState, Field, Money, SegmentedControl, Stepper, TicketLine } from "../components/system";
import { isComposing } from "../lib/keyboard";
import type { LocalCatalogView, LocalOrderView } from "../lib/localPosCore";
import { formatMoney } from "../lib/money";
import { serviceTypeWords } from "../lib/words";
import type { ServiceType } from "../lib/posContracts";
import { MAX_LINE_QUANTITY } from "../lib/posContracts";
import { REGISTER_KEYS } from "./TicketActions";

export interface OfflineTicketProps {
  /** The sale as the till's own store has it. */
  order: LocalOrderView | undefined;
  currency: string;
  /** The order types the saved menu allows. */
  serviceTypes: LocalCatalogView["serviceTypes"];
  serviceType: string;
  onServiceType: (type: string) => void;
  /** The table (or room), saved with the sale when the field is left. */
  label: string;
  onLabel: (label: string) => void;
  onLabelDone: () => void;
  selectedLineId: string | null;
  onSelectLine: (lineId: string | null) => void;
  onQuantity: (lineId: string, quantity: number) => void;
  onRemoveLine: (lineId: string) => void;
  /** A change is with the till's store. */
  busy: boolean;
  /** Why the last change didn't happen, in words. */
  problem: string | null;
  onPay: () => void;
}

/**
 * The offline ticket, beside the saved menu: the order type and table, the
 * lines (quantity, name, options, price), the selected line's quantity and
 * Remove, the till's own totals, and one action: take cash. Nothing goes to
 * the kitchen and nothing else can be done until the connection returns.
 */
export function OfflineTicket({
  order,
  currency,
  serviceTypes,
  serviceType,
  onServiceType,
  label,
  onLabel,
  onLabelDone,
  selectedLineId,
  onSelectLine,
  onQuantity,
  onRemoveLine,
  busy,
  problem,
  onPay,
}: OfflineTicketProps) {
  const lines = order?.lines ?? [];
  // Once the sale is saved for paying, its lines can't change (the till's store keeps it as it was).
  const open = order?.state === "DRAFT";
  const payable = Boolean(order) && lines.length > 0 && order!.state !== "SETTLED" && !busy;
  const type = serviceTypes.find((entry) => entry.id === serviceType);

  const keys = useRef({ payable, onPay });
  keys.current = { payable, onPay };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isComposing(event) || document.querySelector('[role="dialog"]')) return;
      if (event.key === REGISTER_KEYS.pay && keys.current.payable) {
        event.preventDefault();
        keys.current.onPay();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="y-ticket" data-testid="offline-order-rail">
      <header className="y-ticket__head">
        <div className="y-ticket__title-row">
          <h2 className="y-ticket__title">New sale</h2>
          <span className="y-ticket__who">Saved on this till</span>
        </div>
        {serviceTypes.length > 1 ? (
          <SegmentedControl
            label="Order type"
            value={serviceType}
            onChange={onServiceType}
            options={serviceTypes.map((entry) => ({
              value: entry.id,
              label: serviceTypeWords(entry.id as ServiceType) || entry.label,
            }))}
            disabled={!open || busy || lines.length > 0}
            testIdPrefix="service-type"
          />
        ) : null}
        {type?.requiresContext ? (
          <Field
            label="Table"
            value={label}
            onChange={onLabel}
            onBlur={onLabelDone}
            onKeyDown={(event) => {
              if (event.key === "Enter") onLabelDone();
            }}
            autoComplete="off"
            disabled={!open || busy}
            data-testid="table-label"
          />
        ) : null}
      </header>

      <div className="y-ticket__lines" aria-label="Lines">
        {lines.length === 0 ? (
          <EmptyState icon={<Banknote />} title="Tap an item to start a cash sale." description="Sales are saved on this till while it works offline." />
        ) : (
          <ul className="y-ticket__list">
            {lines.map((line) => {
              const selected = line.id === selectedLineId;
              return (
                <li key={line.id} data-testid={`cart-${line.name}`}>
                  <TicketLine
                    quantity={line.quantity}
                    name={line.name}
                    options={line.modifiers.map((modifier) => modifier.name)}
                    amount={formatMoney(line.lineTotalMinor, currency)}
                    selected={selected}
                    onSelect={open ? () => onSelectLine(selected ? null : line.id) : undefined}
                  />
                  {selected && open ? (
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
                      <Stepper label={line.name} value={line.quantity} min={1} max={MAX_LINE_QUANTITY} onChange={(quantity) => !busy && onQuantity(line.id, quantity)} />
                      <Button variant="danger-outline" icon={<Trash2 />} disabled={busy} onClick={() => onRemoveLine(line.id)}>
                        Remove
                      </Button>
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
              <Money minor={order && lines.length > 0 ? order.subtotalMinor : null} currency={currency} />
            </dd>
          </div>
          <div>
            <dt>VAT</dt>
            <dd>
              <Money minor={order && lines.length > 0 ? order.taxMinor : null} currency={currency} />
            </dd>
          </div>
          <div className="y-ticket__total">
            <dt>Total</dt>
            <dd data-testid="cart-preview-total">
              <Money minor={order && lines.length > 0 ? order.totalMinor : null} currency={currency} size="heading" />
            </dd>
          </div>
        </dl>
        {problem ? (
          <p className="y-ticket__error" role="alert" data-testid="offline-error">
            {problem}
          </p>
        ) : null}
        <div className="y-actions">
          <Button
            variant="primary"
            size={64}
            block
            icon={<Banknote />}
            keyHint={REGISTER_KEYS.pay}
            data-testid="offline-pay"
            disabled={!payable}
            onClick={onPay}
          >
            {order && lines.length > 0 ? `Take ${formatMoney(order.totalMinor, currency)} cash` : "Take cash"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
