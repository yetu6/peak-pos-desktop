/**
 * Named settings for shift and cash. Where a value mirrors a backend rule,
 * the rule is named so both move together.
 */

/**
 * Who sees Yetu's expected cash figure while a shift is open. "managers"
 * (staff holding pos.report.manager) keeps the drawer count blind for
 * everyone else: they see the figure only on the close-shift Check, after
 * they have counted. "everyone" shows it to all staff.
 */
export type ExpectedCashAudience = "managers" | "everyone";

export const EXPECTED_CASH_VISIBLE_TO: ExpectedCashAudience = "managers";

export function expectedCashVisible(
  isManager: boolean,
  audience: ExpectedCashAudience = EXPECTED_CASH_VISIBLE_TO,
): boolean {
  return audience === "everyone" || isManager;
}
