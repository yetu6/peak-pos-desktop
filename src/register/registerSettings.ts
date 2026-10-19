/**
 * Named settings for Sell. Where a value mirrors a backend rule, the rule is
 * named so both move together.
 */

/**
 * register.autoReturnSeconds: after a payment, Sell comes back on its own
 * after this many seconds (New sale does it at once). It waits while the
 * pointer is over the payment screen or one of its buttons has focus.
 */
export const REGISTER_AUTO_RETURN_SECONDS = 8;

/**
 * register.quietAfterReturnMs: when the payment screen goes back to Sell on
 * its own, a tap on the menu this soon after is taken as the person reaching
 * for the payment screen's button, not a sale, and starts no order (F-232).
 */
export const REGISTER_QUIET_AFTER_RETURN_MS = 800;

/**
 * register.payCheckEverySeconds: while a payment's answer was lost, how often
 * the Pay sheet sends the same request to Yetu again (once at once, then this
 * often) until Yetu answers for it.
 */
export const PAY_CHECK_EVERY_SECONDS = 5;
