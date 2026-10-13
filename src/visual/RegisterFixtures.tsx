import { useState, type ReactNode } from "react";
import { ReceiptSheet } from "../components/ReceiptView";
import type { POSOrder } from "../lib/posContracts";
import { ALL_CATEGORIES, MenuPanel } from "../register/MenuPanel";
import { OptionsSheet } from "../register/OptionsSheet";
import { PaymentDone } from "../register/PaymentDone";
import { PaySheetView, type PaySheetViewProps } from "../register/PaySheet";
import { RegisterLayout } from "../register/RegisterLayout";
import { TicketActions } from "../register/TicketActions";
import { TicketPanel } from "../register/TicketPanel";
import {
  BURGER,
  CATEGORIES,
  CHANGE_GIVEN,
  CURRENCY,
  ORDER,
  PAID_ORDER,
  PRODUCTS,
  RECEIPT,
  SENT_ORDER,
  SPLIT_ORDER,
  STAYS,
} from "./registerData";
import { FixtureShell } from "./ShellFixtures";

/**
 * Development-only Sell compositions for the pixel harness: the register's
 * real views with data in the backend's shapes (posContracts.ts). Nothing
 * here talks to a server.
 */

const nothing = () => undefined;

function Sell({
  order,
  selected = null,
  sentAt = null,
  canSend = true,
  canPay = true,
  category = ALL_CATEGORIES,
  moreOpen = false,
  children,
}: {
  order: POSOrder | null;
  selected?: string | null;
  sentAt?: Date | null;
  canSend?: boolean;
  canPay?: boolean;
  category?: string;
  moreOpen?: boolean;
  children?: ReactNode;
}) {
  const [activeCategory, setActiveCategory] = useState(category);
  const [search, setSearch] = useState("");
  const [selectedLine, setSelectedLine] = useState<string | null>(selected);
  return (
    <FixtureShell initialPage="new" workspaceVariant="full">
      <RegisterLayout
        menu={
          <MenuPanel
            categories={CATEGORIES}
            products={PRODUCTS}
            currency={CURRENCY}
            activeCategory={activeCategory}
            onCategory={setActiveCategory}
            search={search}
            onSearch={setSearch}
            addBlocked={order && order.status !== "OPEN" ? "This order has gone to the kitchen. Start a new sale to add more." : null}
            onTap={nothing}
            onSoldOutToggle={nothing}
          />
        }
        ticket={
          <TicketPanel
            order={order}
            currency={CURRENCY}
            serviceType="DINE_IN"
            onServiceType={nothing}
            label=""
            onLabel={nothing}
            selectedLineId={selectedLine}
            onSelectLine={setSelectedLine}
            onAddAnother={nothing}
            onRemoveLine={nothing}
            lineBusy={false}
            sentAt={sentAt}
            error={null}
            actions={
              <TicketActions
                order={order}
                currency={CURRENCY}
                busy={false}
                sending={false}
                canSend={canSend}
                canPay={canPay}
                onSend={nothing}
                onPay={nothing}
                onDiscount={nothing}
                onVoid={nothing}
                onNote={nothing}
                onNewSale={nothing}
                initialMoreOpen={moreOpen}
              />
            }
          />
        }
      />
      {children}
    </FixtureShell>
  );
}

/** Sell with an order on the ticket, one line chosen: Add another and Remove. */
export function RegisterFixture() {
  return <Sell order={ORDER} selected="line-burger" />;
}

/** A new sale: the empty ticket. */
export function RegisterEmptyFixture() {
  return <Sell order={null} category="mains" />;
}

/** The order has gone to the kitchen: the time, the menu says why nothing more can be added. */
export function RegisterSentFixture() {
  return <Sell order={SENT_ORDER} selected="line-burger" sentAt={new Date(2026, 9, 12, 14, 5)} />;
}

/** A waiter who can neither send nor take payment. */
export function RegisterLimitedFixture() {
  return <Sell order={ORDER} canSend={false} canPay={false} />;
}

/** More: discount, void, the order note, a new sale. */
export function RegisterMoreFixture() {
  return <Sell order={ORDER} moreOpen />;
}

/** Choosing options: required first, optional after. */
export function RegisterOptionsFixture() {
  return (
    <Sell order={ORDER}>
      <OptionsSheet product={BURGER} currency={CURRENCY} onCancel={nothing} onAdd={nothing} />
    </Sell>
  );
}

function Pay(props: Partial<PaySheetViewProps>) {
  return (
    <Sell order={ORDER}>
      <PaySheetView
        order={ORDER}
        currency={CURRENCY}
        roomAvailable
        roomQuery=""
        onRoomQuery={nothing}
        candidates={[]}
        searching={false}
        searched={false}
        pending={false}
        problem={null}
        onClose={nothing}
        onTender={nothing}
        onChargeRoom={nothing}
        {...props}
      />
    </Sell>
  );
}

/** Cash: TSh 50,000 received, change to give. */
export function PayCashFixture() {
  return <Pay initialReceived="50000" />;
}

/** A split: part already paid, cash for less than the rest. */
export function PaySplitFixture() {
  return <Pay order={SPLIT_ORDER} initialReceived="10000" />;
}

/** Card on the outlet's own machine. */
export function PayCardFixture() {
  return <Pay initialMethod="EXTERNAL_CARD" />;
}

/** Mobile money. */
export function PayMobileFixture() {
  return <Pay initialMethod="MOBILE_MONEY" />;
}

/** Bank transfer. */
export function PayBankFixture() {
  return <Pay initialMethod="BANK_TRANSFER" />;
}

/** Other. */
export function PayOtherFixture() {
  return <Pay initialMethod="OTHER" problem="That's more than is still owed. Check the amount, then try again." />;
}

/** Charge to room on a sent order: guests found, one whose bill isn't open, one chosen. */
export function PayRoomFixture() {
  return <Pay order={SENT_ORDER} initialMethod="ROOM_CHARGE" roomQuery="1" searched candidates={STAYS} initialStayId="s12" />;
}

/** Paid in cash, with change to give. */
export function PaymentDoneFixture() {
  return (
    <Sell order={null}>
      <PaymentDone
        paid={{ order: PAID_ORDER, method: "CASH", changeMinor: CHANGE_GIVEN }}
        currency={CURRENCY}
        onNewSale={nothing}
        onViewReceipt={nothing}
      />
    </Sell>
  );
}

/** The receipt Yetu kept, paid in two tenders. */
export function ReceiptFixture() {
  return (
    <Sell order={null}>
      <ReceiptSheet
        receipt={RECEIPT}
        loading={false}
        failed={false}
        reprinting={false}
        reprintError={null}
        onReprint={nothing}
        onClose={nothing}
      />
    </Sell>
  );
}
