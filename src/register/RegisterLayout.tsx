import type { ReactNode } from "react";

/**
 * Sell: the open orders across the top, then the menu beside the order
 * ticket. The ticket keeps a fixed width (--ticket-width: 400px, 360px on a
 * small screen) and stays on screen while the menu is browsed or searched;
 * only each side scrolls inside itself. The open orders span both, so a
 * waiter's orders read in full instead of squeezed above the ticket.
 */
export function RegisterLayout({ bar, menu, ticket }: { bar?: ReactNode; menu: ReactNode; ticket: ReactNode }) {
  return (
    <div className="y-register" data-testid="register">
      {bar ? <div className="y-register__bar">{bar}</div> : null}
      <section className="y-register__menu" aria-label="Menu">
        {menu}
      </section>
      <aside className="y-register__ticket" aria-label="Order" data-testid="ticket-panel">
        {ticket}
      </aside>
    </div>
  );
}
