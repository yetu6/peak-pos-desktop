import { useState, type ReactNode } from "react";
import { ReceiptSheet } from "../components/ReceiptView";
import type { POSCatalogProduct, POSCategory, POSOrder, POSOrderItem, POSReceipt, POSRoomChargeCandidate } from "../lib/posContracts";
import { ALL_CATEGORIES, MenuPanel } from "../register/MenuPanel";
import { OptionsSheet } from "../register/OptionsSheet";
import { PaymentDone } from "../register/PaymentDone";
import { PaySheetView, type PaySheetViewProps } from "../register/PaySheet";
import { RegisterLayout } from "../register/RegisterLayout";
import { TicketActions } from "../register/TicketActions";
import { TicketPanel } from "../register/TicketPanel";
import { FixtureShell } from "./ShellFixtures";

/**
 * Development-only Sell compositions for the pixel harness: the register's
 * real views with data in the backend's shapes (posContracts.ts). Nothing
 * here talks to a server.
 */

const CURRENCY = "TZS";
const nothing = () => undefined;

const CATEGORIES: POSCategory[] = [
  { id: "coffee", outletId: "o", code: "COF", name: "Coffee", sortOrder: 1, isActive: true },
  { id: "breakfast", outletId: "o", code: "BRK", name: "Breakfast", sortOrder: 2, isActive: true },
  { id: "mains", outletId: "o", code: "MNS", name: "Mains", sortOrder: 3, isActive: true },
  { id: "drinks", outletId: "o", code: "DRK", name: "Drinks", sortOrder: 4, isActive: true },
  { id: "desserts", outletId: "o", code: "DST", name: "Desserts", sortOrder: 5, isActive: true },
];

function item(id: string, name: string, categoryId: string, priceMinor: number, extra: Partial<POSCatalogProduct> = {}): POSCatalogProduct {
  return { id, categoryId, code: id.toUpperCase(), name, priceMinor, currency: CURRENCY, taxRateBp: 1800, isAvailable: true, ...extra };
}

const BURGER: POSCatalogProduct = item("burger", "House burger", "mains", 2_200_000, {
  modifierGroups: [
    {
      id: "cook",
      productId: "burger",
      name: "Cooked",
      minSelect: 1,
      maxSelect: 1,
      isActive: true,
      options: [
        { id: "rare", groupId: "cook", name: "Rare", priceDeltaMinor: 0, isAvailable: true },
        { id: "medium", groupId: "cook", name: "Medium", priceDeltaMinor: 0, isAvailable: true },
        { id: "well", groupId: "cook", name: "Well done", priceDeltaMinor: 0, isAvailable: true },
      ],
    },
    {
      id: "extras",
      productId: "burger",
      name: "Extras",
      minSelect: 0,
      maxSelect: 2,
      isActive: true,
      options: [
        { id: "cheese", groupId: "extras", name: "Cheese", priceDeltaMinor: 150_000, isAvailable: true },
        { id: "egg", groupId: "extras", name: "Fried egg", priceDeltaMinor: 100_000, isAvailable: true },
        { id: "bacon", groupId: "extras", name: "Bacon", priceDeltaMinor: 250_000, isAvailable: true },
      ],
    },
  ],
});

const PRODUCTS: POSCatalogProduct[] = [
  item("capp", "Cappuccino", "coffee", 650_000),
  item("flat", "Flat white", "coffee", 700_000),
  item("spiced", "Spiced Zanzibar coffee with ginger and cardamom", "coffee", 800_000),
  item("breakfast", "Full breakfast", "breakfast", 1_800_000),
  item("avo", "Avocado toast", "breakfast", 1_450_000, { isAvailable: false }),
  BURGER,
  item("chicken", "Grilled chicken", "mains", 2_500_000),
  item("curry", "Coconut curry", "mains", 2_150_000),
  item("nyama", "Nyama choma", "mains", 2_800_000),
  item("tusker", "Tusker lager", "drinks", 500_000),
  item("juice", "Passion juice", "drinks", 600_000),
  item("water", "Sparkling water", "drinks", 400_000),
  item("tart", "Chocolate tart", "desserts", 950_000),
];

function line(id: string, name: string, quantity: number, totalMinor: number, extra: Partial<POSOrderItem> = {}): POSOrderItem {
  return { id, productId: id, name, quantity, unitPriceMinor: totalMinor, taxMinor: 0, totalMinor, status: "ADDED", ...extra };
}

const ORDER: POSOrder = {
  id: "order-1",
  shiftId: "shift-1",
  orderNumber: "0142",
  status: "OPEN",
  serviceType: "DINE_IN",
  tableLabel: "12",
  initiatedById: "staff-amina",
  initiatedByName: "Amina Hassan",
  subtotalMinor: 3_601_695,
  discountMinor: 0,
  discountKind: "NONE",
  discountInput: 0,
  taxMinor: 648_305,
  totalMinor: 4_250_000,
  paidMinor: 0,
  remainingMinor: 4_250_000,
  version: 4,
  items: [
    line("capp", "Cappuccino", 2, 1_534_000),
    line("burger", "House burger", 1, 2_891_000, {
      modifiers: [
        { id: "m1", groupName: "Cooked", optionName: "Medium", priceDeltaMinor: 0 },
        { id: "m2", groupName: "Extras", optionName: "Cheese", priceDeltaMinor: 150_000 },
      ],
    }),
    line("water", "Sparkling water", 1, 472_000),
  ],
};

const SENT_ORDER: POSOrder = {
  ...ORDER,
  status: "SENT",
  items: ORDER.items.map((entry) => ({ ...entry, status: "SENT" })),
};

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
  return <Sell order={ORDER} selected="burger" />;
}

/** A new sale: the empty ticket. */
export function RegisterEmptyFixture() {
  return <Sell order={null} category="mains" />;
}

/** The order has gone to the kitchen: the time, the menu says why nothing more can be added. */
export function RegisterSentFixture() {
  return <Sell order={SENT_ORDER} selected="burger" sentAt={new Date(2026, 9, 12, 14, 5)} />;
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

const STAYS: POSRoomChargeCandidate[] = [
  { stayId: "s12", roomId: "r12", roomNumber: "12", guestDisplayName: "Asha Mollel", postingEligible: true },
  { stayId: "s14", roomId: "r14", roomNumber: "14", guestDisplayName: "Daniel Mrema", postingEligible: true },
  { stayId: "s21", roomId: "r21", roomNumber: "21", guestDisplayName: "Neema Kiwelu", postingEligible: false },
];

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
  const part = { ...ORDER, paidMinor: 2_000_000, remainingMinor: 2_250_000 };
  return <Pay order={part} initialReceived="10000" />;
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

/** Charge to room: guests found, one whose bill isn't open, one chosen. */
export function PayRoomFixture() {
  return <Pay initialMethod="ROOM_CHARGE" roomQuery="1" searched candidates={STAYS} initialStayId="s12" />;
}

/** Paid in cash, with change to give. */
export function PaymentDoneFixture() {
  return (
    <Sell order={null}>
      <PaymentDone
        paid={{ order: { ...ORDER, status: "CLOSED", paidMinor: 4_250_000, remainingMinor: 0 }, method: "CASH", changeMinor: 750_000 }}
        currency={CURRENCY}
        onNewSale={nothing}
        onViewReceipt={nothing}
      />
    </Sell>
  );
}

const RECEIPT: POSReceipt = {
  id: "receipt-1",
  orderId: "order-1",
  status: "PRINTED",
  reprintCount: 0,
  createdAt: new Date(2026, 9, 12, 14, 32).toISOString(),
  document: {
    orderId: "order-1",
    orderNumber: "0142",
    businessDate: "2026-10-12",
    propertyName: "Jacaranda Lodge",
    outletId: "o",
    outletName: "Main Restaurant",
    terminalId: "t",
    initiatedById: "staff-amina",
    initiatedByName: "Amina Hassan",
    operatorId: "staff-grace",
    operatorName: "Grace Mushi",
    serviceType: "DINE_IN",
    tableLabel: "12",
    items: [
      { name: "Cappuccino", quantity: 2, unitPriceMinor: 650_000, taxMinor: 234_000, totalMinor: 1_534_000 },
      {
        name: "House burger",
        quantity: 1,
        unitPriceMinor: 2_350_000,
        taxMinor: 423_000,
        totalMinor: 2_773_000,
        modifiers: [
          { id: "m1", groupName: "Cooked", optionName: "Medium", priceDeltaMinor: 0 },
          { id: "m2", groupName: "Extras", optionName: "Cheese", priceDeltaMinor: 150_000 },
        ],
      },
    ],
    subtotalMinor: 3_650_000,
    taxMinor: 657_000,
    totalMinor: 4_307_000,
    currency: CURRENCY,
    tenderMethod: "SPLIT",
    settledAt: new Date(2026, 9, 12, 14, 32).toISOString(),
  },
};

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
