/** W5 paper and printer-setting words, kept together for staff-facing copy. */
export const PAPER_WORDS = {
  item: "ITEM",
  quantity: "QTY",
  amount: "AMOUNT",
  kitchenOrder: "KITCHEN ORDER",
  barOrder: "BAR ORDER",
  handOver: "HAND OVER",
  make: "MAKE",
  quantityBold: "Bold quantities",
  quantityLarge: "Large quantities",
  billLogo: "Print the business logo on bills",
  logoSource: "The logo comes from the property branding in the hotel app.",
  logoHelp: "Use a simple logo. Photos and gradients may print poorly. If the image cannot print, the business name still prints. Switch the logo off if the printer does not support images.",
  payThanks: "Please pay at the till. Thank you.",
  thanks: "Thank you.",
} as const;

export function roundWords(round?: number): string {
  return round ? ` · ROUND ${round}${round > 1 ? " · ADDED" : ""}` : "";
}
export function productionEndWords(count: number): string {
  return `*** END · ${count} ${count === 1 ? "ITEM" : "ITEMS"} ***`;
}
export function stationCopiesWords(station: string): string { return `${station}: copies`; }
