import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTillMenu } from "./useTillMenu";
import { NO_MENU } from "./fnbContracts";

const { realtime, answer } = vi.hoisted(() => ({
  realtime: { handler: null as null | ((event: { type: string }) => void) },
  answer: { status: 200, data: undefined as unknown, error: undefined as unknown },
}));

vi.mock("../hooks/usePosData", () => ({
  useOutletMoneySettings: () => ({ standardFloat: 0, quickCashNotes: [1000,2000,5000,10000] }), useOutletId: () => "outlet-1" }));
vi.mock("../realtime/RealtimeProvider", () => ({
  useRealtimeEvents: (_target: unknown, handler: (event: { type: string }) => void) => {
    realtime.handler = handler;
  },
}));
vi.mock("./fnbApi", () => ({
  createFnbApi: () => ({
    fnbGetTillMenu: async () => ({ data: answer.data, error: answer.error, response: { status: answer.status } }),
  }),
}));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { invalidate, ...renderHook(() => useTillMenu(), { wrapper }) };
}

beforeEach(() => {
  realtime.handler = null;
  answer.status = 200;
  answer.data = undefined;
  answer.error = undefined;
});

describe("useTillMenu", () => {
  it("a Yetu without the module (404) is no menu: the till sells as before", async () => {
    answer.status = 404;
    answer.error = { code: "NOT_FOUND" };
    const { result } = setup();
    await waitFor(() => expect(result.current.data).toEqual(NO_MENU));
  });

  it("reads the menu, and again (with the catalogue) when Yetu says the menu or the catalogue changed", async () => {
    answer.data = { ...NO_MENU, enabled: true };
    const { result, invalidate } = setup();
    await waitFor(() => expect(result.current.data?.enabled).toBe(true));
    realtime.handler?.({ type: "fnb.menu.updated" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["fnb", "menu", "outlet-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pos", "catalog"] });
    invalidate.mockClear();
    realtime.handler?.({ type: "pos.catalog.updated" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["pos", "catalog"] });
  });

  it("other news doesn't read the menu again", async () => {
    answer.data = NO_MENU;
    const { invalidate } = setup();
    await waitFor(() => expect(realtime.handler).not.toBeNull());
    realtime.handler?.({ type: "pos.order.item_added" });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useTillMenu: happy hour starts and ends (S17c)", () => {
  it("reads the menu again when a rule starts or ends, as Yetu says", async () => {
    answer.data = { ...NO_MENU, prices: {}, pricesChangeInSeconds: 90 };
    // The menu's own timer is kept to run by hand; every other timer runs as usual.
    const timers: Array<{ ms: number; run: () => void }> = [];
    const realSetTimeout = window.setTimeout.bind(window);
    const setTimer = vi.spyOn(window, "setTimeout").mockImplementation(((run: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 91_000) {
        timers.push({ ms, run });
        return 0 as unknown as number;
      }
      return realSetTimeout(run, ms, ...rest);
    }) as typeof window.setTimeout);
    try {
      const { result, invalidate } = setup();
      await waitFor(() => expect(result.current.data?.pricesChangeInSeconds).toBe(90));
      const timer = timers.find((entry) => entry.ms === 91_000);
      expect(timer).toBeDefined();
      invalidate.mockClear();
      timer?.run();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["fnb", "menu", "outlet-1"] });
    } finally {
      setTimer.mockRestore();
    }
  });
});
