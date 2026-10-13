import { useHasPermission } from "../hooks/usePosData";
import { expectedCashVisible } from "./cashSettings";

/** Whether this person may see Yetu's expected cash figure outside the close-shift Check (EXPECTED_CASH_VISIBLE_TO). */
export function useExpectedCashVisible(): boolean {
  return expectedCashVisible(useHasPermission("pos.report.manager"));
}
