import { useQuery } from "@tanstack/react-query";
import { CASH_IN_REASONS, CASH_OUT_REASONS } from "../cash/cashSettings";
import { useOutletId } from "../hooks/usePosData";
import { DISCOUNT_REASONS, REFUND_REASONS, VOID_REASONS } from "../orders/ordersSettings";
import { createFnbApi } from "./fnbApi";
import type { FnbTillReasons } from "./fnbContracts";

export type ReasonKind = keyof FnbTillReasons;

/**
 * reasons.refreshSeconds: how long the reasons the till last read stay good.
 * A sheet that asks why reads them again after this, so a manager's change in
 * the hotel app shows within a minute without a message to every till.
 */
export const REASONS_REFRESH_SECONDS = 60;

/** The till's own named lists: what it offers until Yetu answers, and when Yetu can't give them. */
const TILL_REASONS: Record<ReasonKind, readonly string[]> = {
  discount: DISCOUNT_REASONS,
  void: VOID_REASONS,
  refund: REFUND_REASONS,
  cashIn: CASH_IN_REASONS,
  cashOut: CASH_OUT_REASONS,
};

/**
 * The reasons a sheet offers in one tap (ReasonPicker): the outlet's lists as
 * its managers keep them in the hotel app (2026-10-20), else Yetu's standard
 * ones. The till's own lists stand in while Yetu answers, and when it can't be
 * reached or has no lists (a Yetu before them answers 404), so a sheet always
 * offers reasons.
 */
export function useTillReasons(kind: ReasonKind): readonly string[] {
  const outletId = useOutletId();
  const query = useQuery({
    queryKey: ["fnb", "reasons", outletId],
    queryFn: async (): Promise<FnbTillReasons | null> => {
      const { data, error, response } = await createFnbApi().fnbGetTillReasons();
      if (response.status === 404) return null;
      if (error) throw new Error(typeof error === "string" ? error : JSON.stringify(error));
      return data ?? null;
    },
    staleTime: REASONS_REFRESH_SECONDS * 1000,
    retry: false,
  });
  const kept = query.data?.[kind];
  return kept && kept.length > 0 ? kept : TILL_REASONS[kind];
}
