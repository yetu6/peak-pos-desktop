import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TillControls } from "./TillControls";
import type { PosSessionResponse } from "../lib/posApi";

function mutation<T>(overrides: Partial<{
  mutate: (value: number) => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T;
}> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...overrides,
  };
}

const OPEN_SESSION = {
  id: "session-1",
  status: "open",
  expectedCash: 100,
  openingFloat: 100,
} as PosSessionResponse;

describe("TillControls", () => {
  it("opens the till with the cashier's float, not a silent zero", async () => {
    const open = mutation<PosSessionResponse>();
    render(<TillControls session={null} open={open} close={mutation()} />);
    expect(screen.getByTestId("open-session")).toBeDisabled();
    await userEvent.type(screen.getByTestId("opening-float"), "100");
    await userEvent.click(screen.getByTestId("open-session"));
    expect(open.mutate).toHaveBeenCalledWith(100);
    expect(screen.queryByTestId("cash-in")).not.toBeInTheDocument();
    expect(screen.queryByTestId("cash-out")).not.toBeInTheDocument();
  });

  it("shows a variance that still needs a supervisor after close", () => {
    render(
      <TillControls
        session={null}
        open={mutation()}
        close={mutation({
          data: {
            id: "session-1",
            status: "pending_variance_approval",
            variance: 5,
          } as PosSessionResponse,
        })}
      />,
    );
    expect(screen.getByTestId("till-close-result")).toHaveTextContent(
      "Variance 5 needs a supervisor",
    );
  });

  it("closes with the counted drawer against Peak's expected cash", async () => {
    const close = mutation<PosSessionResponse | undefined>();
    render(<TillControls session={OPEN_SESSION} open={mutation()} close={close} />);
    expect(screen.getByTestId("session-open")).toHaveTextContent("expected 100");
    await userEvent.type(screen.getByTestId("actual-cash"), "100");
    await userEvent.click(screen.getByTestId("close-session"));
    expect(close.mutate).toHaveBeenCalledWith(100);
  });
});
