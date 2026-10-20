import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTillReasons } from "./useTillReasons";
import { DISCOUNT_REASONS, VOID_REASONS } from "../orders/ordersSettings";
import { CASH_OUT_REASONS } from "../cash/cashSettings";

const { answer } = vi.hoisted(() => ({
  answer: { status: 200, data: undefined as unknown, error: undefined as unknown, refuse: false, calls: 0 },
}));

vi.mock("../hooks/usePosData", () => ({ useOutletId: () => "outlet-1" }));
vi.mock("./fnbApi", () => ({
  createFnbApi: () => ({
    fnbGetTillReasons: async () => {
      answer.calls += 1;
      if (answer.refuse) throw new TypeError("Failed to fetch: no route to Yetu");
      return { data: answer.data, error: answer.error, response: { status: answer.status } };
    },
  }),
}));

function setup(kind: Parameters<typeof useTillReasons>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return renderHook(() => useTillReasons(kind), { wrapper });
}

const KEPT = { discount: ["Birthday", "Regular guest"], void: ["Wrong table"], refund: ["Cold"], cashIn: ["Float"], cashOut: ["Gas"] };

beforeEach(() => {
  answer.status = 200;
  answer.data = undefined;
  answer.error = undefined;
  answer.refuse = false;
  answer.calls = 0;
});

describe("useTillReasons", () => {
  it("offers the reasons the outlet's managers keep", async () => {
    answer.data = KEPT;
    const { result } = setup("discount");
    await waitFor(() => expect(result.current).toEqual(["Birthday", "Regular guest"]));
  });

  it("offers the till's own lists until Yetu answers", () => {
    answer.data = KEPT;
    const { result } = setup("void");
    expect(result.current).toEqual(VOID_REASONS);
  });

  it("keeps the till's own lists when Yetu has no lists (404), can't be reached, or sends an empty one", async () => {
    answer.status = 404;
    answer.error = { code: "NOT_FOUND" };
    const missing = setup("discount");
    await waitFor(() => expect(missing.result.current).toEqual(DISCOUNT_REASONS));

    answer.refuse = true;
    const unreachable = setup("cashOut");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unreachable.result.current).toEqual(CASH_OUT_REASONS);

    answer.refuse = false;
    answer.status = 200;
    answer.error = undefined;
    answer.data = { ...KEPT, cashOut: [] };
    const empty = setup("cashOut");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(empty.result.current).toEqual(CASH_OUT_REASONS);
  });

  it("a Yetu without the lists isn't asked again by every sheet: its 404 holds for the minute", async () => {
    answer.status = 404;
    answer.error = { code: "NOT_FOUND" };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const first = renderHook(() => useTillReasons("discount"), { wrapper });
    await waitFor(() => expect(answer.calls).toBe(1));
    first.unmount();
    renderHook(() => useTillReasons("void"), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(answer.calls).toBe(1);
  });
});
