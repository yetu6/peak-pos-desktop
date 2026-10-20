import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OpenDrawerSheetView } from "./OpenDrawerSheet";
import { DRAWER_REASONS } from "./cashSettings";

const refused = (problem: Record<string, unknown>) => new Error(JSON.stringify(problem));

// The owner, 2026-10-21: anyone who takes money may open the drawer without a
// sale, with a reason, and every opening is recorded (fbc-peak #289).
describe("OpenDrawerSheetView", () => {
  it("offers the outlet's reasons in one tap, and opens only once one is chosen", async () => {
    const onOpen = vi.fn();
    render(<OpenDrawerSheetView pending={false} error={null} onClose={vi.fn()} onOpen={onOpen} />);
    const open = screen.getByTestId("confirm-open-drawer");
    expect(open).toBeDisabled();
    expect(screen.getByTestId("drawer-reason-0")).toHaveTextContent(DRAWER_REASONS[0]);
    await userEvent.click(screen.getByTestId("drawer-reason-1"));
    await userEvent.click(open);
    expect(onOpen).toHaveBeenCalledWith(DRAWER_REASONS[1]);
  });

  it("another reason is typed, and goes as typed", async () => {
    const onOpen = vi.fn();
    render(<OpenDrawerSheetView reasons={["Check the float"]} pending={false} error={null} onClose={vi.fn()} onOpen={onOpen} />);
    await userEvent.click(screen.getByTestId("drawer-reason-other"));
    await userEvent.type(screen.getByTestId("drawer-reason-text"), "  Count for the auditor ");
    await userEvent.click(screen.getByTestId("confirm-open-drawer"));
    expect(onOpen).toHaveBeenCalledWith("Count for the auditor");
  });

  it("says why Yetu didn't record it, and the drawer stays shut", () => {
    const { rerender } = render(
      <OpenDrawerSheetView pending={false} error={refused({ code: "FORBIDDEN" })} onClose={vi.fn()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId("open-drawer-error")).toHaveTextContent("Only a cashier or manager can open the drawer.");
    rerender(<OpenDrawerSheetView pending={false} error={refused({ code: "SHIFT_NOT_OPEN" })} onClose={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId("open-drawer-error")).toHaveTextContent("No shift is open on this till.");
    rerender(<OpenDrawerSheetView pending={false} error={new TypeError("Failed to fetch")} onClose={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId("open-drawer-error")).toHaveTextContent("The drawer stays shut until Yetu records why it opens.");
  });

  it("while Yetu records it, nothing more is sent", () => {
    render(<OpenDrawerSheetView pending error={null} onClose={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByTestId("confirm-open-drawer")).toBeDisabled();
    expect(screen.getByTestId("confirm-open-drawer")).toHaveTextContent("Recording…");
  });
});
