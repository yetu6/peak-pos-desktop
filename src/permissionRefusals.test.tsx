import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CashMovementSheetView } from "./components/CashMovementDialog";
import { ReceiptSheet } from "./components/ReceiptView";
import { CloseDayCardView } from "./cash/CloseDayCard";
import { cashMovementProblem, closeShiftProblem, dayCloseProblem } from "./cash/cashWords";
import { KitchenBoard } from "./kitchen/KitchenBoard";
import { kitchenProblem } from "./kitchen/kitchenWords";
import { ticketsFromOrders } from "./kitchen/kitchenTickets";
import { OrderDetailView } from "./orders/OrderDetail";
import { reprintProblem, sendProblem } from "./orders/ordersWords";
import { OpenShiftView } from "./pages/OpenShiftScreen";
import { openShiftProblem } from "./cash/cashWords";
import { PaySheetView } from "./register/PaySheet";
import { tenderProblem } from "./register/registerWords";
import { FIXTURE_NOW, OPEN_ORDERS, STATION_TICKETS } from "./visual/ordersData";
import { CURRENCY, RECEIPT, SENT_ORDER } from "./visual/registerData";

/**
 * Yetu's 403 for a role without the permission (fbc-peak internal/pos/errors.go
 * writeDomainError: httpx.Forbidden), as the hooks throw it. Every screen that
 * can meet it shows a PermissionNotice, announced as a failure, never the code.
 */
const FORBIDDEN = new Error(
  JSON.stringify({ type: "about:blank", title: "Forbidden.", status: 403, code: "FORBIDDEN", detail: "POS permission denied", request_id: "req-1" }),
);

const nothing = () => undefined;

function expectPermissionNotice(words: string) {
  const alert = screen.getByRole("alert");
  expect(alert).toHaveClass("y-permission");
  expect(alert).toHaveTextContent(words);
  expect(document.body).not.toHaveTextContent(/403|FORBIDDEN|permission denied/i);
}

describe("a refusal for a role without the permission (403)", () => {
  it("taking payment", () => {
    render(
      <PaySheetView
        order={SENT_ORDER}
        currency={CURRENCY}
        roomAvailable={false}
        roomQuery=""
        onRoomQuery={nothing}
        candidates={[]}
        searching={false}
        searched={false}
        pending={false}
        problem={tenderProblem(FORBIDDEN)}
        onClose={nothing}
        onTender={nothing}
        onChargeRoom={nothing}
      />,
    );
    expectPermissionNotice("Only a cashier or manager can take payment. Ask one to help.");
  });

  it("cash in or out", () => {
    render(<CashMovementSheetView onClose={nothing} currency={CURRENCY} roster={[]} requesterId="staff-amina" pending={false} error={FORBIDDEN} onRecord={nothing} />);
    expect(cashMovementProblem(FORBIDDEN, "CASH_IN")?.kind).toBe("permission");
    expectPermissionNotice("Only a cashier or manager can put cash in or take it out. Ask one to help.");
  });

  it("closing the day", () => {
    render(<CloseDayCardView thisTillShiftOpen={false} pending={false} error={FORBIDDEN} nextBusinessDate={null} onCloseDay={nothing} />);
    expect(dayCloseProblem(FORBIDDEN)?.kind).toBe("permission");
    expectPermissionNotice("Only a manager can close the day. Ask one to close it.");
  });

  it("closing the shift (its words)", () => {
    expect(closeShiftProblem(FORBIDDEN)).toEqual({ kind: "permission", words: "Only a cashier or manager can close the shift. Ask one to close it." });
  });

  it("opening the shift", () => {
    render(
      <OpenShiftView
        person={{ name: "Amina Hassan", initials: "AH" }}
        tillName="Main Restaurant"
        currency={CURRENCY}
        canOpenShift
        pending={false}
        error={openShiftProblem(FORBIDDEN)}
        closed={null}
        closeDay={null}
        onSwitchPerson={nothing}
        onOpen={nothing}
      />,
    );
    expectPermissionNotice("Only a cashier or manager can open the shift. Ask one to open it.");
  });

  it("sending an order from its detail", () => {
    render(
      <OrderDetailView
        order={SENT_ORDER}
        currency={CURRENCY}
        timeline={[]}
        canSend
        canPay
        pending={null}
        problem={sendProblem(FORBIDDEN)}
        result={null}
        selectedLineId={null}
        onSelectLine={nothing}
        onSend={nothing}
        onPay={nothing}
        onVoid={nothing}
        onRemoveLine={nothing}
        onQuantity={nothing}
        onReprint={nothing}
        onClose={nothing}
      />,
    );
    expectPermissionNotice("Only staff who take orders can send them to the kitchen. Ask one to help.");
  });

  it("printing a copy of a receipt from an order", () => {
    expect(reprintProblem(FORBIDDEN)).toEqual({ kind: "permission", words: "Only a cashier or manager can print a copy of the receipt. Ask one to help." });
  });

  it("printing a copy from the receipt", () => {
    render(<ReceiptSheet receipt={RECEIPT} loading={false} failed={false} reprinting={false} reprintError={reprintProblem(FORBIDDEN)} onReprint={nothing} onClose={vi.fn()} />);
    expectPermissionNotice("Only a cashier or manager can print a copy of the receipt. Ask one to help.");
  });

  it("moving a kitchen ticket", () => {
    render(
      <KitchenBoard
        title="Kitchen"
        tickets={ticketsFromOrders(OPEN_ORDERS, STATION_TICKETS)}
        nowMs={FIXTURE_NOW}
        busyIds={new Set()}
        canMove
        onNextStep={nothing}
        problem={kitchenProblem(FORBIDDEN)}
      />,
    );
    expectPermissionNotice("This ticket can't be moved from here.");
  });
});
