/**
 * Named settings for Orders. Each is a default a business could change; the
 * screens read them from here, never a literal.
 */

/**
 * orders.paidSearchMostPages: how many of Yetu's pages of the day's paid
 * orders a search reads before it stops and says it didn't read them all
 * (at Yetu's default page of 50, the latest 500). The Paid tab shows one page
 * at a time; "Show more" asks for the next.
 */
export const PAID_SEARCH_MOST_PAGES = 10;

/**
 * orders.openMostPages: a ceiling on Yetu's pages of open orders the till
 * reads (at its default page of 50, a thousand open orders). Far above any
 * outlet's open orders; it keeps a list that never ends from running on.
 */
export const OPEN_MOST_PAGES = 20;

/**
 * orders.paidListRefreshSeconds: while the Paid tab is open, how often it
 * asks Yetu again, and only once a payment at the outlet has made it out of
 * date, so a busy outlet's payments don't each reload every page read.
 */
export const PAID_LIST_REFRESH_SECONDS = 30;

/**
 * orders.refreshSeconds: while Orders is open, how often it asks Yetu again
 * for the open orders (through their station tickets), besides live updates,
 * so a missed update still shows. The same as the kitchen board's.
 */
export const ORDERS_REFRESH_SECONDS = 15;

/**
 * orders.refundReasons: the reasons a cashier picks from when giving money
 * back, besides typing their own. Each is written as staff would say it.
 */
export const REFUND_REASONS: readonly string[] = [
  "Cold or not as ordered",
  "Wrong item served",
  "Guest changed their mind",
  "Charged twice",
];

/**
 * orders.discountReasons: the reasons a cashier picks from when asking for a
 * discount, besides typing their own (ReasonPicker). The supervisor approves
 * the reason with the amount.
 */
export const DISCOUNT_REASONS: readonly string[] = [
  "Regular guest",
  "Staff meal",
  "Slow service",
  "Problem with the food or drink",
  "Manager's guest",
];

/**
 * orders.voidReasons: the reasons a cashier picks from when voiding an unpaid
 * order, besides typing their own.
 */
export const VOID_REASONS: readonly string[] = [
  "Entered by mistake",
  "Entered twice",
  "Guest changed their mind",
  "Guest left",
  "Kitchen ran out",
];
