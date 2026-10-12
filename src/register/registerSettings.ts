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
