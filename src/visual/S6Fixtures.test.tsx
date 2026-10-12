import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OfflineCashFixture,
  OfflineCashShortFixture,
  OfflineRegisterFixture,
  OfflineSavedFixture,
  PayChangedElsewhereFixture,
  PayUnsureFixture,
  RefusalPermissionFixture,
  StatusBrowserFixture,
  StatusFixture,
  SyncProblemFixture,
  SyncWaitingFixture,
} from "./S6Fixtures";

describe("S6 fixtures", () => {
  it("the offline register: banner, cash only, money words", () => {
    render(<OfflineRegisterFixture />);
    expect(screen.getByTestId("offline-banner")).toHaveTextContent("Working offline. Cash only.");
    expect(screen.getByTestId("offline-pay")).toHaveTextContent(/^Take TSh [\d,]+ cash/);
    expect(screen.queryByTestId("send-order")).toBeNull();
  });

  it("offline cash: change in words; short: paid in full", () => {
    render(<OfflineCashFixture />);
    expect(screen.getByTestId("change-due")).toHaveTextContent(/^Change to give TSh [\d,]+$/);
  });

  it("offline cash short", () => {
    render(<OfflineCashShortFixture />);
    expect(screen.getByTestId("change-due")).toHaveTextContent("Offline, a sale is paid in full in cash.");
  });

  it("offline saved", () => {
    render(<OfflineSavedFixture />);
    expect(screen.getByTestId("offline-sale-saved-line")).toHaveTextContent(/^Sale saved on this till · Change TSh [\d,]+$/);
  });

  it("sync: waiting and a problem", () => {
    render(<SyncWaitingFixture />);
    expect(screen.getByTestId("sync-waiting")).toHaveTextContent("3 sales waiting to send");
  });

  it("sync problem: banner and chip", () => {
    render(<SyncProblemFixture />);
    expect(screen.getByTestId("sync-problem-banner")).toHaveTextContent("2 sales on this till need a manager to check them.");
    expect(screen.getByTestId("conn-label")).toHaveTextContent("Sync problem");
  });

  it("status: checks with what to do; a browser offers no test page", () => {
    render(<StatusFixture />);
    expect(screen.getByRole("button", { name: "Print test page" })).toBeInTheDocument();
    expect(screen.getByTestId("diag-check-receipt-printer")).toHaveTextContent("EPSON TM-T20III");
  });

  it("status in a browser", () => {
    render(<StatusBrowserFixture />);
    expect(screen.queryByRole("button", { name: "Print test page" })).toBeNull();
  });

  it("refusals and recovery", () => {
    render(<RefusalPermissionFixture />);
    expect(screen.getByRole("alert")).toHaveClass("y-permission");
  });

  it("pay unsure offers no payment", () => {
    render(<PayUnsureFixture />);
    expect(screen.getByTestId("pay-unsure")).toHaveTextContent("Still can't reach Yetu.");
    expect(screen.queryByTestId("confirm-settle")).toBeNull();
  });

  it("pay changed elsewhere", () => {
    render(<PayChangedElsewhereFixture />);
    expect(screen.getByTestId("settle-error")).toHaveTextContent("This order was paid or changed on another till, so this payment wasn't recorded.");
  });
});
