import { useEffect, useMemo, useState } from "react";
import { useLocalCatalog, useLocalDraft } from "../hooks/useLocalOrder";
import type { OfflineCashCommitResult } from "../lib/localPosCore";
import type { POSCatalogProduct } from "../lib/posContracts";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { ALL_CATEGORIES, MenuPanel } from "../register/MenuPanel";
import { OfflineCashSheet } from "../register/OfflineCashSheet";
import { OfflineSaleSaved } from "../register/OfflineSaleSaved";
import { OfflineTicket } from "../register/OfflineTicket";
import { OptionsSheet } from "../register/OptionsSheet";
import { RegisterLayout } from "../register/RegisterLayout";
import { OFFLINE_MENU_MISSING, offlineProblemWords } from "../register/offlineWords";
import { menuOf } from "../register/offlineMenu";
import { useCachedTillMenu } from "../fnb/useTillMenu";

/** The order type a new offline sale starts with (the store needs one to make the draft). */
const FIRST_SERVICE_TYPE = "DINE_IN";

/**
 * Sell while the till works offline (PIN unlock entered `offline-cash`: Yetu
 * unreachable, a certified offline lease). The same layout as Sell, over the
 * till's own store: add, change the quantity, remove, and take cash for the
 * whole sale. Nothing goes to the kitchen, no other way to pay, no discount
 * or void; the sale is sent to Yetu when the connection returns (Sync).
 */
export function OfflineNewOrder() {
  const [serviceType, setServiceType] = useState<string>(FIRST_SERVICE_TYPE);
  const [label, setLabel] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<POSCatalogProduct | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  // Cash for a sale just saved for paying: it is taken once the store's saved sale is on screen.
  const [cashToTake, setCashToTake] = useState<number | null>(null);
  const [saved, setSaved] = useState<OfflineCashCommitResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saleProblem, setSaleProblem] = useState<string | null>(null);

  // The whole saved menu once; the menu panel searches and filters it itself.
  const catalog = useLocalCatalog("", undefined);
  const { draft, addItem, setQuantity, removeLine, updateContext, commit, settleCash } = useLocalDraft(FIRST_SERVICE_TYPE);
  const order = draft.data;
  const currency = catalog.data?.currency ?? order?.currency ?? "";
  const menu = useMemo(() => menuOf(catalog.data), [catalog.data]);
  // The groups, tags and sizes Yetu last sent, when the till has them: never asked for offline.
  const tillMenu = useCachedTillMenu();
  const busy = addItem.isPending || setQuantity.isPending || removeLine.isPending || updateContext.isPending;
  const saving = commit.isPending || settleCash.isPending || cashToTake !== null;
  // The till doesn't lock itself while the sale is being saved on it.
  useHoldIdleLock(saving);

  useEffect(() => {
    if (order?.serviceType) setServiceType(order.serviceType);
  }, [order?.serviceType]);

  /** Each change waits for the store's answer before the next (each names the version it expects). */
  async function change(step: () => Promise<unknown>, kind: "add" | "change") {
    setProblem(null);
    try {
      await step();
    } catch (error) {
      setProblem(offlineProblemWords(error, kind));
      void draft.refetch();
    }
  }

  function tap(product: POSCatalogProduct) {
    if (busy || !order || order.state !== "DRAFT") return;
    if ((product.modifierGroups?.length ?? 0) > 0) {
      addItem.reset();
      setConfiguring(product);
      return;
    }
    void change(() => addItem.mutateAsync({ productId: product.id, quantity: 1, modifierOptionIds: [] }), "add");
  }

  function settle(cashReceivedMinor: number) {
    settleCash.mutate(cashReceivedMinor, {
      onSuccess: (result) => {
        setPayOpen(false);
        setSaved(result);
      },
      onError: (error) => setSaleProblem(offlineProblemWords(error, "sale")),
    });
  }

  async function takeCash(cashReceivedMinor: number) {
    if (!order) return;
    setSaleProblem(null);
    if (order.state === "DRAFT") {
      // First the store keeps the sale as it is (a new version), then the cash is taken against
      // that version, once it is on screen: taking it at once would name the old one.
      try {
        await commit.mutateAsync();
        setCashToTake(cashReceivedMinor);
      } catch (error) {
        setSaleProblem(offlineProblemWords(error, "sale"));
      }
      return;
    }
    settle(cashReceivedMinor);
  }

  useEffect(() => {
    if (cashToTake === null || order?.state !== "COMMITTED") return;
    const cash = cashToTake;
    setCashToTake(null);
    settle(cash);
    // Runs when the saved sale (its new version) is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashToTake, order?.state, order?.version]);

  function newSale() {
    setSaved(null);
    setLabel("");
    setSelectedLineId(null);
    void draft.refetch();
  }

  return (
    <div className="y-offline-register" data-testid="offline-new-order">
      <RegisterLayout
        menu={
          <MenuPanel
            categories={menu.categories}
            products={menu.products}
            currency={currency || undefined}
            activeCategory={category}
            onCategory={setCategory}
            search={search}
            onSearch={setSearch}
            addBlocked={order && order.state !== "DRAFT" ? "This sale is being paid. Start a new sale to add more." : null}
            onTap={tap}
            loading={catalog.isLoading}
            failed={catalog.isError}
            failedWords={OFFLINE_MENU_MISSING}
            menu={tillMenu}
            offline
          />
        }
        ticket={
          <OfflineTicket
            order={order}
            currency={currency}
            serviceTypes={catalog.data?.serviceTypes ?? []}
            serviceType={serviceType}
            onServiceType={(next) => {
              setServiceType(next);
              void change(() => updateContext.mutateAsync({ serviceType: next, tableLabel: label.trim() || undefined }), "change");
            }}
            label={label}
            onLabel={setLabel}
            onLabelDone={() => {
              if (!order || (order.tableLabel ?? "") === label.trim()) return;
              void change(() => updateContext.mutateAsync({ serviceType, tableLabel: label.trim() || undefined }), "change");
            }}
            selectedLineId={selectedLineId}
            onSelectLine={setSelectedLineId}
            onQuantity={(lineId, quantity) => void change(() => setQuantity.mutateAsync({ lineId, quantity }), "change")}
            onRemoveLine={(lineId) => {
              setSelectedLineId(null);
              void change(() => removeLine.mutateAsync(lineId), "change");
            }}
            busy={busy || saving}
            problem={problem}
            onPay={() => {
              setSaleProblem(null);
              setPayOpen(true);
            }}
          />
        }
      />
      {configuring ? (
        <OptionsSheet
          product={configuring}
          currency={currency}
          pending={addItem.isPending}
          error={problem}
          onCancel={() => setConfiguring(null)}
          onAdd={(choice) =>
            void change(async () => {
              await addItem.mutateAsync({ productId: configuring.id, quantity: choice.quantity, modifierOptionIds: choice.modifierOptionIds });
              setConfiguring(null);
            }, "add")
          }
        />
      ) : null}
      {payOpen && order ? (
        <OfflineCashSheet
          dueMinor={order.totalMinor}
          currency={currency}
          saving={saving}
          problem={saleProblem}
          onCancel={() => setPayOpen(false)}
          onConfirm={(cash) => void takeCash(cash)}
        />
      ) : null}
      {saved ? <OfflineSaleSaved result={saved} currency={currency} onNewSale={newSale} /> : null}
    </div>
  );
}
