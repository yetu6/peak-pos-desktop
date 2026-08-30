import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePosShift } from "./usePosData";
import type { POSShift } from "../lib/posContracts";

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({ tenantId: "t1", userId: "u1", propertyId: "property-1", outletId: "outlet-1" }),
}));

const OPEN_SHIFT: POSShift = {
  id: "shift-1",
  status: "OPEN",
  openingCashMinor: 10_000,
  expectedCashMinor: 10_000,
  businessDate: "2026-08-30",
  openedAt: "2026-08-30T08:00:00Z",
};

const { openShiftSpy } = vi.hoisted(() => ({
  openShiftSpy: vi.fn(async () => ({ data: OPEN_SHIFT, error: null })),
}));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({ openShift: openShiftSpy, getShift: vi.fn(async () => ({ data: OPEN_SHIFT, error: null })) }),
}));

/** Two independent components each call usePosShift() — exactly how
 *  TillControls (header) and a page's own body do it in production. Both
 *  must observe the same shift once one of them opens it, without a remount. */
function HeaderProbe() {
  const { shift, open } = usePosShift();
  return (
    <div>
      <span data-testid="header-shift">{shift ? "OPEN" : "NONE"}</span>
      <button data-testid="header-open" onClick={() => open.mutate({ openingCashMinor: 10_000, idempotencyKey: "k1" })}>
        open
      </button>
    </div>
  );
}

function BodyProbe() {
  const { shift } = usePosShift();
  return <span data-testid="body-shift">{shift ? "OPEN" : "NONE"}</span>;
}

describe("usePosShift", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps two independent call sites in sync after opening a shift (regression: R6A-C visual certification)", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <HeaderProbe />
        <BodyProbe />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("header-shift")).toHaveTextContent("NONE");
    expect(screen.getByTestId("body-shift")).toHaveTextContent("NONE");

    await userEvent.click(screen.getByTestId("header-open"));

    await waitFor(() => expect(screen.getByTestId("header-shift")).toHaveTextContent("OPEN"));
    // The regression: this used to stay "NONE" because storedId lived in a
    // per-instance useState instead of the shared query cache.
    await waitFor(() => expect(screen.getByTestId("body-shift")).toHaveTextContent("OPEN"));
  });
});
