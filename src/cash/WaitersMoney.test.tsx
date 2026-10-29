import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { POSWaiterMoney } from "../lib/posContracts";
import { waitersHoldWords } from "./cashWords";
import { WaiterOwnMoney, WaitersMoneyCard } from "./WaitersMoney";

const asha: POSWaiterMoney = {
  staffId: "s-asha",
  name: "Asha",
  ordersTaken: 3,
  ordersOpen: 1,
  cashMinor: 4_740_000,
  mobileMoneyMinor: 1_200_000,
  cardMinor: 0,
  otherMinor: 0,
  handedInMinor: 2_000_000,
  owedMinor: 0,
  heldMinor: 2_740_000,
};
const baraka: POSWaiterMoney = { ...asha, staffId: "s-baraka", name: "Baraka", cashMinor: 0, mobileMoneyMinor: 0, handedInMinor: 0, heldMinor: 0 };

// Waiters collect (owner, 2026-10-29; fbc-peak #327): the waiter keeps the
// cash until the cashier counts it in; nothing waits for a waiter at close.
describe("waiters' money", () => {
  it("the cashier sees each waiter, and Receive only for one who holds cash", async () => {
    const onReceive = vi.fn();
    render(<WaitersMoneyCard waiters={[asha, baraka]} currency="TZS" onReceive={onReceive} />);
    const card = screen.getByTestId("waiters-money");
    expect(card).toHaveTextContent("Asha");
    expect(card).toHaveTextContent("3 orders, 1 not paid yet");
    expect(card).toHaveTextContent("Mobile money TSh 12,000");
    expect(within(card).getByText(/Holds/)).toHaveTextContent("TSh 27,400");
    expect(screen.queryByTestId("receive-s-baraka")).toBeNull();
    expect(card).toHaveTextContent("Nothing to hand in");
    await userEvent.click(screen.getByTestId("receive-s-asha"));
    expect(onReceive).toHaveBeenCalledWith(asha);
  });

  it("the waiter sees what to hand in, not the drawer", () => {
    render(<WaiterOwnMoney money={asha} currency="TZS" loading={false} />);
    const card = screen.getByTestId("waiter-own-money");
    expect(card).toHaveTextContent("Cash to hand in");
    expect(card).toHaveTextContent("TSh 27,400");
    expect(card).toHaveTextContent("Hand it to the cashier");
    expect(card).not.toHaveTextContent(/drawer/i);
  });

  it("before the close, who still holds cash is said, and what closing does about it", () => {
    expect(waitersHoldWords([baraka], "TZS")).toBeNull();
    expect(waitersHoldWords([asha, baraka], "TZS")).toBe(
      "Asha still holds TSh 27,400. If you close now, it's recorded as owed by Asha.",
    );
    expect(waitersHoldWords([asha, { ...asha, name: "Baraka", heldMinor: 1_000_000 }], "TZS")).toBe(
      "Asha and Baraka still hold cash (TSh 37,400 in all). If you close now, what each holds is recorded as owed by them.",
    );
  });
});
