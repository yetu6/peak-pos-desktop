/**
 * Named settings for Orders. Each is a default a business could change; the
 * screens read them from here, never a literal.
 */

/**
 * orders.paidRowsShown: how many paid orders the Paid tab lists before
 * "Show more" (and how many more each press shows). Searching covers them all.
 */
export const PAID_ROWS_SHOWN = 20;

/**
 * orders.paidListRefreshSeconds: while the Paid tab is open, how often it
 * asks Yetu again, and only once a payment at the outlet has made it out of
 * date. Yetu's list of paid orders is every order the outlet has had, so it
 * is not asked for again on each payment.
 */
export const PAID_LIST_REFRESH_SECONDS = 30;
