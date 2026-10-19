import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useAddOrderItem, useOrder } from "./usePosData";

/**
 * F-255 (2026-10-20): each add on Bahari's till was followed by a second
 * request for the same order, though Yetu's answer to the add is the whole
 * order as it now is. The till keeps that answer; other orders and the lists
 * are still asked again, since another till may have changed them.
 */

vi.mock("../lib/env", () => ({
  devIdentityFromEnv: () => ({ tenantId: "t1", userId: "u1", propertyId: "property-1", outletId: "outlet-1" }),
}));

const ORDER_ID = "e7288589-1a61-44a9-a735-bc9058651782";
const OTHER_ID = "0b1d5f0e-2b8e-4a77-9f3e-5a1c2d3e4f50";

function order(id: string, version: number) {
  return { id, version, status: "OPEN", items: Array.from({ length: version - 1 }, (_, index) => ({ id: `line-${index}` })) };
}

const api = vi.hoisted(() => ({
  getOrder: vi.fn(),
  addItem: vi.fn(),
}));
vi.mock("../lib/posApi", () => ({ createPosApi: () => api }));

function Till() {
  const open = useOrder(ORDER_ID);
  const other = useOrder(OTHER_ID);
  const addItem = useAddOrderItem();
  return (
    <>
      <p data-testid="version">{open.data ? `version ${open.data.version}` : "loading"}</p>
      <p data-testid="other">{other.data ? `version ${other.data.version}` : "loading"}</p>
      <button
        type="button"
        onClick={() =>
          void addItem.mutateAsync({ orderId: ORDER_ID, productId: "water", quantity: 1, version: 1, idempotencyKey: "add-1" })
        }
      >
        Add
      </button>
    </>
  );
}

describe("an add's answer is the order as Yetu has it (F-255)", () => {
  it("is kept, not asked for again; another open order is still asked again", async () => {
    const versions: Record<string, number> = { [ORDER_ID]: 1, [OTHER_ID]: 4 };
    api.getOrder.mockImplementation(async (id: string) => ({ data: order(id, versions[id]), response: new Response(null, { status: 200 }) }));
    api.addItem.mockImplementation(async () => {
      versions[ORDER_ID] = 2;
      versions[OTHER_ID] = 5; // another till's change meanwhile
      return { data: order(ORDER_ID, 2), response: new Response(null, { status: 201 }) };
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } })}>
        <Till />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("version")).toHaveTextContent("version 1"));
    await waitFor(() => expect(screen.getByTestId("other")).toHaveTextContent("version 4"));
    const asked = (id: string) => api.getOrder.mock.calls.filter(([orderId]) => orderId === id).length;
    expect(asked(ORDER_ID)).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.getByTestId("version")).toHaveTextContent("version 2"));
    await waitFor(() => expect(screen.getByTestId("other")).toHaveTextContent("version 5"));
    expect(asked(ORDER_ID)).toBe(1);
  });
});
