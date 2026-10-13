import type { UseMutationResult } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Banner } from "../components/system";
import { buildTechnicianSnapshot } from "../lib/diagnostics";
import type { LocalOrderView, SyncState } from "../lib/localPosCore";
import { StatusView, statusChecks } from "../pages/Diagnostics";
import { ALL_CATEGORIES, MenuPanel } from "../register/MenuPanel";
import { OfflineCashSheet } from "../register/OfflineCashSheet";
import { OfflineSaleSaved } from "../register/OfflineSaleSaved";
import { OfflineTicket } from "../register/OfflineTicket";
import { PaySheetView } from "../register/PaySheet";
import { RegisterLayout } from "../register/RegisterLayout";
import { TicketActions } from "../register/TicketActions";
import { TicketPanel } from "../register/TicketPanel";
import { menuOf } from "../register/offlineMenu";
import { OFFLINE_BANNER, OFFLINE_MENU_MISSING, offlineProblemWords } from "../register/offlineWords";
import { lostAnswerRefusalWords } from "../register/registerWords";
import { SyncChip, SyncProblemBanner, SyncSheet, type SyncCenterState } from "../sync/SyncCenter";
import { EMPTY_SALE, LOCAL_CATALOG, LOCAL_SALE, OFFLINE_CASH_RECEIVED, SAVED_SALE, SYNC_PROBLEM, SYNC_WAITING } from "./offlineData";
import { CATEGORIES, CURRENCY, ORDER, PRODUCTS, SENT_ORDER } from "./registerData";
import { FixtureShell } from "./ShellFixtures";

/**
 * Development-only S6 compositions for the pixel harness: the offline
 * register, Sync, Status and the refusal and recovery states, from the real
 * views with data in the till store's and Yetu's own shapes. Nothing here
 * talks to a server or to the till's store.
 */

const nothing = () => undefined;

/** Sync as the shell holds it, at one moment: the store's state, the live connection, and Try again's last answer. */
function fixtureSync(state: SyncState | null, options: { phase?: string; open?: boolean; after?: SyncState; before?: SyncState } = {}): SyncCenterState {
  const after = options.after;
  return {
    native: state !== null,
    state,
    realtime: { phase: (options.phase ?? (state?.status === "Live" ? "connected" : "disconnected")) as never, attempt: 3, lastError: "websocket closed", established: true, resyncGeneration: 2 },
    open: options.open ?? false,
    setOpen: nothing,
    retry: { isPending: false, isError: false, isSuccess: Boolean(after), data: after, mutate: nothing } as unknown as UseMutationResult<SyncState, unknown, void>,
    before: options.before ?? null,
  };
}

function OfflineSell({ sale = LOCAL_SALE, failed = false, children }: { sale?: LocalOrderView; failed?: boolean; children?: ReactNode }) {
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(sale.lines[1]?.id ?? null);
  const menu = menuOf(LOCAL_CATALOG);
  const sync = fixtureSync(SYNC_WAITING);
  return (
    <FixtureShell
      offlineCash
      initialPage="new"
      workspaceVariant="full"
      connection={<SyncChip sync={sync} />}
      banners={
        <Banner tone="warning" data-testid="offline-banner">
          {OFFLINE_BANNER}
        </Banner>
      }
    >
      <RegisterLayout
        menu={
          <MenuPanel
            categories={menu.categories}
            products={menu.products}
            currency={CURRENCY}
            activeCategory={category}
            onCategory={setCategory}
            search={search}
            onSearch={setSearch}
            addBlocked={null}
            onTap={nothing}
            failed={failed}
            failedWords={OFFLINE_MENU_MISSING}
          />
        }
        ticket={
          <OfflineTicket
            order={sale}
            currency={CURRENCY}
            serviceTypes={LOCAL_CATALOG.serviceTypes}
            serviceType="DINE_IN"
            onServiceType={nothing}
            label={sale.tableLabel ?? ""}
            onLabel={nothing}
            onLabelDone={nothing}
            selectedLineId={selected}
            onSelectLine={setSelected}
            onQuantity={nothing}
            onRemoveLine={nothing}
            busy={false}
            problem={null}
            onPay={nothing}
          />
        }
      />
      {children}
    </FixtureShell>
  );
}

/** Working offline: Sell's layout over the saved menu, a cash-only ticket, the fixed banner. */
export function OfflineRegisterFixture() {
  return <OfflineSell />;
}

/** Working offline with nothing on the ticket yet. */
export function OfflineRegisterEmptyFixture() {
  return <OfflineSell sale={EMPTY_SALE} />;
}

/** No menu saved for working offline. */
export function OfflineNoMenuFixture() {
  return <OfflineSell sale={EMPTY_SALE} failed />;
}

/** Taking cash offline: the cash typed in shillings, and the change. */
export function OfflineCashFixture() {
  return (
    <OfflineSell>
      <OfflineCashSheet
        dueMinor={LOCAL_SALE.totalMinor}
        currency={CURRENCY}
        saving={false}
        problem={null}
        onCancel={nothing}
        onConfirm={nothing}
        initialReceived={String(OFFLINE_CASH_RECEIVED / 100)}
      />
    </OfflineSell>
  );
}

/** Less than the total offline: paid in full in cash, and how much more. */
export function OfflineCashShortFixture() {
  return (
    <OfflineSell>
      <OfflineCashSheet dueMinor={LOCAL_SALE.totalMinor} currency={CURRENCY} saving={false} problem={null} onCancel={nothing} onConfirm={nothing} initialReceived="20000" />
    </OfflineSell>
  );
}

/** The till's store refused the sale: in words, with what to do. */
export function OfflineCashProblemFixture() {
  return (
    <OfflineSell>
      <OfflineCashSheet
        dueMinor={LOCAL_SALE.totalMinor}
        currency={CURRENCY}
        saving={false}
        problem={offlineProblemWords("LIMIT_EXCEEDED", "sale")}
        onCancel={nothing}
        onConfirm={nothing}
        initialReceived={String(OFFLINE_CASH_RECEIVED / 100)}
      />
    </OfflineSell>
  );
}

/** Sale saved on this till, with the change, waiting to send. */
export function OfflineSavedFixture() {
  return (
    <OfflineSell sale={EMPTY_SALE}>
      <OfflineSaleSaved result={SAVED_SALE} currency={CURRENCY} onNewSale={nothing} />
    </OfflineSell>
  );
}

/** Sync open from the chip while offline: three sales waiting to send. */
export function SyncWaitingFixture() {
  return (
    <OfflineSell>
      <SyncSheet sync={fixtureSync(SYNC_WAITING, { open: true, after: SYNC_WAITING })} />
    </OfflineSell>
  );
}

/** A sync problem: the chip, the banner until it is resolved, and Sync saying what to do. */
export function SyncProblemFixture() {
  const sync = fixtureSync(SYNC_PROBLEM, { phase: "connected", open: true });
  return (
    <FixtureShell initialPage="new" workspaceVariant="full" connection={<SyncChip sync={sync} />} banners={<SyncProblemBanner sync={sync} />}>
      <SellBehind />
      <SyncSheet sync={sync} />
    </FixtureShell>
  );
}

/** Sync in a browser (no store on the till): the live connection only. */
export function SyncBrowserFixture() {
  const sync = fixtureSync(null, { phase: "reconnecting", open: true });
  return (
    <FixtureShell initialPage="new" workspaceVariant="full" connection={<SyncChip sync={sync} />}>
      <SellBehind />
      <SyncSheet sync={sync} />
    </FixtureShell>
  );
}

const SNAPSHOT_INPUT = {
  identity: { deviceCode: "7F3K-9ABC", terminalName: "Main Restaurant", mode: "POS" } as never,
  session: { terminalId: "8a6f2c1e-4d0b-4c1a-9a51-0f6b8e2d7c10" } as never,
  host: { os: "windows", arch: "x86_64", appVersion: "0.1.1" },
  printer: { available: true, name: "EPSON TM-T20III" },
  keyStorage: { hardwareBacked: true, backend: "windows-credential-manager", warning: null },
  peakOrigin: "https://api.yetu.fbcsoftwares.com",
};

function Status({ problems = false, browser = false, printed = null }: { problems?: boolean; browser?: boolean; printed?: { ok: boolean; detail: string | null } | null }) {
  const printer = browser ? null : problems ? { available: false, name: null } : SNAPSHOT_INPUT.printer;
  const keyStorage = problems ? { hardwareBacked: false, backend: "file", warning: "file fallback" } : SNAPSHOT_INPUT.keyStorage;
  const peak = problems
    ? { status: "unreachable" as const, detail: "Failed to fetch", origin: SNAPSHOT_INPUT.peakOrigin }
    : { status: "reachable" as const, detail: "HTTP 200", origin: SNAPSHOT_INPUT.peakOrigin };
  const realtime = { phase: problems ? "disconnected" : "connected", attempt: problems ? 4 : 0, lastError: problems ? "websocket closed" : null };
  return (
    <FixtureShell initialPage="status">
      <StatusView
        checks={statusChecks({ online: !problems, peak, realtime: realtime.phase, printer, native: !browser, keyStorage })}
        canPrintTestPage={!browser && !problems}
        checking={false}
        onCheckAgain={nothing}
        testPrint={printed}
        testPrintBusy={false}
        onTestPrint={nothing}
        updateNote={null}
        snapshot={buildTechnicianSnapshot({ ...SNAPSHOT_INPUT, printer, keyStorage })}
        peak={peak}
        realtime={realtime}
      />
    </FixtureShell>
  );
}

/** Status on a healthy counter computer, a test page just sent. */
export function StatusFixture() {
  return <Status printed={{ ok: true, detail: null }} />;
}

/** Status with problems: each says what to do. */
export function StatusProblemsFixture() {
  return <Status problems />;
}

/** Status in a browser: no print path, so no Print test page. */
export function StatusBrowserFixture() {
  return <Status browser />;
}

/** Sell behind a sheet: the Sell fixtures' menu and ticket. */
function SellBehind({ error = null }: { error?: { kind: string; words: string } | null }) {
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [search, setSearch] = useState("");
  return (
    <RegisterLayout
      menu={
        <MenuPanel
          categories={CATEGORIES}
          products={PRODUCTS}
          currency={CURRENCY}
          activeCategory={category}
          onCategory={setCategory}
          search={search}
          onSearch={setSearch}
          addBlocked={null}
          onTap={nothing}
          onSoldOutToggle={nothing}
        />
      }
      ticket={
        <TicketPanel
          order={ORDER}
          currency={CURRENCY}
          serviceType="DINE_IN"
          onServiceType={nothing}
          label=""
          onLabel={nothing}
          selectedLineId={null}
          onSelectLine={nothing}
          onAddAnother={nothing}
          onRemoveLine={nothing}
          lineBusy={false}
          sentAt={null}
          error={error}
          actions={
            <TicketActions
              order={ORDER}
              currency={CURRENCY}
              busy={false}
              sending={false}
              canSend
              canPay
              onSend={nothing}
              onPay={nothing}
              onDiscount={nothing}
              onVoid={nothing}
              onNote={nothing}
              onNewSale={nothing}
            />
          }
        />
      }
    />
  );
}

/** Yetu refused a step for this person's role (403): who can, never a code. */
export function RefusalPermissionFixture() {
  return (
    <FixtureShell initialPage="new" workspaceVariant="full">
      <SellBehind error={{ kind: "permission", words: "Only staff who take orders can send them to the kitchen. Ask one to help." }} />
    </FixtureShell>
  );
}

const PAY_VIEW = {
  currency: CURRENCY,
  roomAvailable: false,
  roomQuery: "",
  onRoomQuery: nothing,
  candidates: [],
  searching: false,
  searched: false,
  pending: false,
  recordedMinor: null,
  onClose: nothing,
  onTender: nothing,
  onChargeRoom: nothing,
};

/** The connection dropped while Yetu was recording the payment: no new payment until Yetu answers. */
export function PayUnsureFixture() {
  return (
    <FixtureShell initialPage="new" workspaceVariant="full">
      <SellBehind />
      <PaySheetView {...PAY_VIEW} order={SENT_ORDER} problem={null} unsure={{ failed: true, checking: false, room: false }} onCheck={nothing} initialReceived="50000" />
    </FixtureShell>
  );
}

/** Yetu refused the lost payment when asked again: the order was paid or changed on another till. */
export function PayChangedElsewhereFixture() {
  return (
    <FixtureShell initialPage="new" workspaceVariant="full">
      <SellBehind />
      <PaySheetView
        {...PAY_VIEW}
        order={{ ...SENT_ORDER, paidMinor: 2_000_000, remainingMinor: SENT_ORDER.totalMinor - 2_000_000, version: SENT_ORDER.version + 1 }}
        problem={{
          kind: "other",
          words: lostAnswerRefusalWords(new Error(JSON.stringify({ status: 409, code: "STALE_VERSION", detail: "resource changed" })), false),
        }}
      />
    </FixtureShell>
  );
}
