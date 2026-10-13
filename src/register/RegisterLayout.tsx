import type { ReactNode } from "react";

/**
 * Sell: the menu beside the order ticket. The ticket keeps a fixed width
 * (--ticket-width: 400px, 360px on a small screen) and stays on screen while
 * the menu is browsed or searched; only each side scrolls inside itself.
 */
export function RegisterLayout({ menu, ticket }: { menu: ReactNode; ticket: ReactNode }) {
  return (
    <div className="y-register" data-testid="register">
      <section className="y-register__menu" aria-label="Menu">
        {menu}
      </section>
      <aside className="y-register__ticket" aria-label="Order" data-testid="ticket-panel">
        {ticket}
      </aside>
    </div>
  );
}
