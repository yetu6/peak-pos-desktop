import { ChefHat, CircleCheck, CircleDot, CircleX, CookingPot, UtensilsCrossed } from "lucide-react";
import type { ReactNode } from "react";
import type { OrderStatus } from "../lib/posContracts";

/**
 * Each state of an order its own icon beside its word, so a list is read at
 * a glance: sent, cooking, ready, served. Tones stay for meaning (warning is
 * for trouble, such as a waiting tab or a late ticket; never for progress).
 */
export function orderStatusIcon(status: OrderStatus): ReactNode {
  switch (status) {
    case "SENT":
      return <ChefHat aria-hidden="true" />;
    case "PREPARING":
      return <CookingPot aria-hidden="true" />;
    case "READY":
    case "CLOSED":
      return <CircleCheck aria-hidden="true" />;
    case "SERVED":
      return <UtensilsCrossed aria-hidden="true" />;
    case "VOIDED":
      return <CircleX aria-hidden="true" />;
    default:
      return <CircleDot aria-hidden="true" />;
  }
}
