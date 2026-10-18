/**
 * What staff call an order. Since S5b Yetu gives each order a short number
 * for its outlet and business day (`dailyNumber`, from 1): staff say
 * "Order 42". The long `orderNumber` stays its reference, shown small and
 * still searchable. An order with no number yet (a sale taken offline before
 * it synced, a receipt made before S5b) goes by its reference.
 */
export interface NumberedOrder {
  dailyNumber?: number | null;
  orderNumber?: string | null;
}

function dailyNumberOf(order: NumberedOrder): number | null {
  const number = order.dailyNumber;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : null;
}

/** The order's number as staff say it: "42", or its reference when it has no number. */
export function orderNumberWords(order: NumberedOrder): string {
  const number = dailyNumberOf(order);
  return number !== null ? String(number) : (order.orderNumber ?? "");
}

/** "Order 42". */
export function orderName(order: NumberedOrder): string {
  return `Order ${orderNumberWords(order)}`;
}

/** The reference to show small beside the number, or null when the name already is the reference. */
export function orderReference(order: NumberedOrder): string | null {
  return dailyNumberOf(order) !== null && order.orderNumber ? order.orderNumber : null;
}
