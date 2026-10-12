import { ReceiptText } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Banner, EmptyState, Sheet, StatusChip, SupervisorApproval, SupervisorApprovalActions } from "../components/system";
import type { KeypadKey } from "../components/system";
import { sentTimesByOrder } from "../kitchen/kitchenTickets";
import { shiftChipWords } from "../lib/words";
import type { WorkspacePage } from "../lib/workspace";
import { OrdersView, type OrdersTab } from "../orders/OrdersView";
import { TillShell } from "../shell/TillShell";
import { OPEN_ORDERS, PAID_ORDERS, STATION_TICKETS } from "./ordersData";
import { CURRENCY } from "./registerData";
import "./gallery.css";

/**
 * Development-only shell compositions for the pixel harness. They render the
 * real TillShell with static data in the backend's own shapes
 * (posContracts.ts): no network, no device session.
 */

/** A shift as the backend sends it: opened 07:02 on business day 2026-10-12. */
const BUSINESS_DATE = "2026-10-12";
const OPENED_AT = new Date(2026, 9, 12, 7, 2).toISOString();

/** The Orders list as the shell shows it, with the Orders fixtures' own orders (ordersData.ts). */
function OrdersPreview() {
  const [tab, setTab] = useState<OrdersTab>("open");
  const [query, setQuery] = useState("");
  return (
    <OrdersView
      tab={tab}
      onTab={setTab}
      openOrders={OPEN_ORDERS}
      paidOrders={PAID_ORDERS}
      query={query}
      onQuery={setQuery}
      currency={CURRENCY}
      sentTimes={sentTimesByOrder(STATION_TICKETS)}
      onOpen={() => undefined}
      openState={{ loading: false, failed: false, onRetry: () => undefined }}
      paidState={{ loading: false, failed: false, onRetry: () => undefined }}
    />
  );
}

export function FixtureShell({
  mode = "POS",
  offlineCash = false,
  initialPage = "orders",
  banners,
  workspaceVariant = "padded",
  children,
}: {
  mode?: string;
  offlineCash?: boolean;
  initialPage?: WorkspacePage;
  banners?: ReactNode;
  workspaceVariant?: "padded" | "full";
  children: ReactNode;
}) {
  const [page, setPage] = useState<WorkspacePage>(initialPage);
  return (
    <TillShell
      mode={mode}
      offlineCash={offlineCash}
      page={page}
      onNavigate={setPage}
      tillName="Main Restaurant"
      person={{ name: "Amina Hassan", initials: "AH" }}
      shift={shiftChipWords({ status: "OPEN", openedAt: OPENED_AT, businessDate: BUSINESS_DATE })}
      clock="14:32"
      connection={
        offlineCash ? (
          <StatusChip tone="warning">Offline · 3 sales waiting to send</StatusChip>
        ) : (
          <StatusChip tone="success">Online</StatusChip>
        )
      }
      banners={banners}
      onSwitchPerson={() => undefined}
      onLock={() => undefined}
      workspaceVariant={workspaceVariant}
    >
      {children}
    </TillShell>
  );
}

/** The shell on a selling till, with the Orders list in the new components. */
export function ShellFixture() {
  return (
    <FixtureShell workspaceVariant="full">
      <OrdersPreview />
    </FixtureShell>
  );
}

/** Working offline: closed sections stay in place and say why (F2 pressed to show it). */
export function ShellOfflineFixture() {
  useEffect(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F2" }));
  }, []);
  return (
    <FixtureShell
      offlineCash
      initialPage="new"
      banners={
        <>
          <Banner tone="warning">Working offline. Cash only. Sales are saved on this till and sent when the connection returns.</Banner>
          <Banner tone="info">An update is ready. It installs when the shift is closed.</Banner>
        </>
      }
    >
      <EmptyState
        icon={<ReceiptText />}
        title="Tap an item to start an order."
        description="The menu shows here while the till works offline."
      />
    </FixtureShell>
  );
}

/** A kitchen display: the top bar and the work area, no rail. */
export function ShellKitchenDisplayFixture() {
  return (
    <FixtureShell mode="KITCHEN_DISPLAY" initialPage="kitchen">
      <EmptyState
        icon={<ReceiptText />}
        title="No orders waiting"
        description="New orders appear here as soon as they are sent."
      />
    </FixtureShell>
  );
}

/** Ask a supervisor in a side sheet over the shell. */
export function ApprovalSheetFixture() {
  const [selectedId, setSelectedId] = useState<string | null>("staff-grace");
  const [pinLength, setPinLength] = useState(2);
  function onPinKey(key: KeypadKey) {
    setPinLength((length) => (key === "delete" ? Math.max(0, length - 1) : key === "clear" ? 0 : Math.min(6, length + 1)));
  }
  return (
    <FixtureShell workspaceVariant="full">
      <OrdersPreview />
      <Sheet
        open
        onOpenChange={() => undefined}
        title="Ask a supervisor"
        description="A different person approves this with their own PIN."
        footer={
          <SupervisorApprovalActions onCancel={() => undefined} onApprove={() => undefined} canApprove={pinLength >= 4} />
        }
      >
        <SupervisorApproval
          request="Take TSh 20,000 out of the drawer for the gas delivery"
          supervisors={[
            { id: "staff-amina", name: "Amina Hassan", roleName: "Supervisor" },
            { id: "staff-grace", name: "Grace Mushi", roleName: "Manager" },
            { id: "staff-juma", name: "Juma Ally", roleName: "Supervisor" },
          ]}
          requesterId="staff-amina"
          selectedId={selectedId}
          onSelect={setSelectedId}
          pinLength={pinLength}
          onPinKey={onPinKey}
          status={{ kind: "idle" }}
          onCancel={() => undefined}
          actions="none"
        />
      </Sheet>
    </FixtureShell>
  );
}

/** Ctrl+K pressed over the shell: the command search. */
export function CommandSearchFixture() {
  useEffect(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  }, []);
  return (
    <FixtureShell workspaceVariant="full">
      <OrdersPreview />
    </FixtureShell>
  );
}
