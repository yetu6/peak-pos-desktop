import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TillShell } from "./TillShell";

const updater = vi.hoisted(() => ({ status: { kind: "idle" } as { kind: string; version?: string } }));
vi.mock("../hooks/useShiftSafeUpdater", () => ({
  useShiftSafeUpdater: () => ({ status: updater.status }),
}));

function shell() {
  return (
    <TillShell
      mode="POS"
      page="new"
      onNavigate={vi.fn()}
      person={{ name: "Amina Hassan", initials: "AH" }}
      clock="14:32"
      connection={<span>Online</span>}
      onSwitchPerson={vi.fn()}
      onLock={vi.fn()}
    >
      <p>work</p>
    </TillShell>
  );
}

describe("Status badge", () => {
  it("shows only while an update is downloaded and waiting", () => {
    updater.status = { kind: "downloading", version: "0.1.8" };
    const { rerender } = render(shell());
    expect(screen.queryByTestId("nav-status-update")).toBeNull();
    updater.status = { kind: "ready", version: "0.1.8" };
    rerender(shell());
    expect(screen.getByTestId("nav-status-update")).toBeInTheDocument();
    expect(within(screen.getByTestId("nav-status")).getByText("Update ready")).toBeInTheDocument();
    updater.status = { kind: "idle" };
    rerender(shell());
    expect(screen.queryByTestId("nav-status-update")).toBeNull();
  });

  it("is on the Status entry only", () => {
    updater.status = { kind: "ready", version: "0.1.8" };
    render(shell());
    expect(within(screen.getByTestId("nav-orders")).queryByText("Update ready")).toBeNull();
  });
});
