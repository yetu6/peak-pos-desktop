import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewOrder } from "./NewOrder";
import { clearOperationalSession, setOperationalSession } from "../lib/operationalSession";
import type { POSCatalog } from "../lib/posContracts";
import type { LocalOrderView } from "../lib/localPosCore";

vi.mock("../lib/env", () => ({
  API_BASE_URL: "http://peak.test",
  getApiBaseUrl: () => "http://peak.test",
  REALTIME_BRIDGE_URL: "ws://localhost:5174/bridge",
  devIdentityFromEnv: () => ({ tenantId: "tenant-1", userId: "user-1", propertyId: "property-1", outletId: "outlet-1" }),
}));

const localSpies=vi.hoisted(()=>({addItem:vi.fn(),commit:vi.fn(),setQuantity:vi.fn(),removeLine:vi.fn(),updateContext:vi.fn()}));
vi.mock("../hooks/useLocalOrder",async()=>{
  const React=await import("react");
  const localCatalog={snapshotId:"snap",version:"v1",currency:"TZS",taxMode:"EXCLUSIVE",serviceTypes:[{id:"DINE_IN",label:"Dine in",requiresContext:false}],categories:[],products:[{id:"p1",code:"NC",name:"Nyama Choma",priceMinor:1200000,taxRateBp:1800,currency:"TZS",modifierGroups:[]},{id:"p2",code:"TL",name:"Tusker Lager",priceMinor:500000,taxRateBp:1800,currency:"TZS",modifierGroups:[]}]};
  return {
    useLocalCatalog:()=>({data:localCatalog,isLoading:false,isError:false,error:null}),
    useLocalDraft:()=>{
      const [data,setData]=React.useState<LocalOrderView>({id:"local-1",state:"DRAFT",syncState:"LOCAL_DRAFT",version:1,staffId:"staff-1",serviceType:"DINE_IN",currency:"TZS",subtotalMinor:0,taxMinor:0,totalMinor:0,lines:[]});
      const mutation=<T,>(spy:(arg:T)=>unknown,change:(current:LocalOrderView,args:T)=>LocalOrderView)=>({isPending:false,error:null,mutate:(args:T,options?:{onSuccess?:(value:LocalOrderView)=>void})=>{spy(args);const next=change(data,args);setData(next);options?.onSuccess?.(next)}});
      return {
        draft:{data,isLoading:false,isError:false,error:null,refetch:vi.fn(async()=>({data}))},
        addItem:mutation(localSpies.addItem,(current,args:{productId:string;quantity:number})=>({...current,version:current.version+1,subtotalMinor:847457,taxMinor:152542,totalMinor:999999,lines:[...current.lines,{id:`line-${current.lines.length}`,productId:args.productId,name:args.productId==="p1"?"Nyama Choma":"Tusker Lager",quantity:args.quantity,unitPriceMinor:999999,modifierTotalMinor:0,lineTotalMinor:999999,pricing:{unitNetMinor:847457,unitTaxMinor:152542,unitTotalMinor:999999,lineSubtotalMinor:847457,lineTaxMinor:152542,lineTotalMinor:999999},modifiers:[]}]})),
        setQuantity:mutation(localSpies.setQuantity,current=>current),removeLine:mutation(localSpies.removeLine,current=>current),updateContext:mutation(localSpies.updateContext,current=>({...current,version:current.version+1})),commit:mutation(localSpies.commit,current=>({...current,state:"COMMITTED",syncState:"SYNC_PENDING"})),
      };
    },
  };
});

const CATALOG: POSCatalog = {
  outletId: "outlet-1",
  outletName: "Mama Rose",
  categories: [],
  products: [
    { id: "00000000-0000-0000-0000-000000000001", code: "NC", name: "Nyama Choma", priceMinor: 1200000, currency: "TZS", taxRateBp: 1800 },
    { id: "00000000-0000-0000-0000-000000000006", code: "TL", name: "Tusker Lager", priceMinor: 500000, currency: "TZS", taxRateBp: 1800 },
  ],
};

const { getShiftSpy, openShiftSpy, closeShiftSpy, getCatalogSpy, createOrderSpy, addItemSpy } = vi.hoisted(() => ({
  getShiftSpy: vi.fn(async () => ({ data: { id: "shift-1", status: "OPEN", openingCashMinor: 0, expectedCashMinor: 0, businessDate: "2026-08-29", openedAt: "2026-08-29T08:00:00Z" }, error: null })),
  openShiftSpy: vi.fn(async () => ({ data: { id: "shift-1", status: "OPEN", openingCashMinor: 0, expectedCashMinor: 0, businessDate: "2026-08-29", openedAt: "2026-08-29T08:00:00Z" }, error: null })),
  closeShiftSpy: vi.fn(async () => ({ data: { id: "shift-1", status: "CLOSED", openingCashMinor: 0, expectedCashMinor: 0, businessDate: "2026-08-29", openedAt: "2026-08-29T08:00:00Z" }, error: null })),
  getCatalogSpy: vi.fn(async () => ({ data: CATALOG, error: null })),
  createOrderSpy: vi.fn(async () => ({ data: { id: "order-1", orderNumber: "POS-1", version: 1, shiftId: "shift-1", status: "OPEN", serviceType: "DINE_IN", subtotalMinor: 0, taxMinor: 0, totalMinor: 0, items: [] }, error: null })),
  addItemSpy: vi.fn(async (orderId: string) => ({
    data: { id: orderId, orderNumber: "POS-1", version: 2, shiftId: "shift-1", status: "OPEN", serviceType: "DINE_IN", subtotalMinor: 0, taxMinor: 0, totalMinor: 0, items: [] },
    error: null,
  })),
}));

vi.mock("../lib/posApi", () => ({
  createPosApi: () => ({
    getShift: getShiftSpy,
    openShift: openShiftSpy,
    closeShift: closeShiftSpy,
    getCatalog: getCatalogSpy,
    createOrder: createOrderSpy,
    addItem: addItemSpy,
  }),
}));

function renderNewOrder() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NewOrder />
    </QueryClientProvider>,
  );
}

describe("NewOrder", () => {
  beforeEach(() => {
    localStorage.clear();
    // A POS_CASHIER-equivalent grant so these order-composition tests are
    // not incidentally gated by the R6A-C permission signal; the dedicated
    // gating behavior is covered in TillControls.test.tsx.
    setOperationalSession({
      token: "t", expiresAt: "2099-01-01T00:00:00Z", tenantId: "tenant-1", propertyId: "property-1",
      outletId: "outlet-1", terminalId: "terminal-1", staffId: "staff-1", assurance: "RESTRICTED",
      capabilities: ["CORE", "POS"],
      permissions: ["pos.shift.open", "pos.shift.close", "pos.order.create", "pos.order.item.add", "pos.order.send", "pos.payment.record"],
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearOperationalSession();
  });

  it("opens a shift with the cashier's float and persists the opened id", async () => {
    renderNewOrder();
    await userEvent.type(screen.getByTestId("opening-float"), "0");
    await userEvent.click(await screen.findByTestId("open-shift"));
    await waitFor(() => expect(openShiftSpy).toHaveBeenCalledWith(0, expect.any(String)));
    expect(await screen.findByTestId("shift-open")).toBeInTheDocument();
    expect(localStorage.getItem("peak-pos-shift-property-1-outlet-1")).toBe("shift-1");
  });

  it("reuses a stored open shift and closes it on demand", async () => {
    localStorage.setItem("peak-pos-shift-property-1-outlet-1", "shift-1");
    renderNewOrder();
    await waitFor(() => expect(getShiftSpy).toHaveBeenCalledWith("shift-1"));
    expect(await screen.findByTestId("shift-open")).toBeInTheDocument();

    await userEvent.type(screen.getByTestId("counted-cash"), "0");
    await userEvent.click(screen.getByTestId("close-shift"));
    await waitFor(() => expect(closeShiftSpy).toHaveBeenCalledWith("shift-1", { countedCashMinor: 0, supervisorStaffId: undefined, supervisorPin: undefined }, expect.any(String)));
  });

  it("renders Rust-authoritative totals and secures through the local transaction core", async () => {
    localStorage.setItem("peak-pos-shift-property-1-outlet-1", "shift-1");
    renderNewOrder();
    await screen.findByTestId("shift-open");

    const productTile = await screen.findByTestId("menu-Nyama Choma");
    expect(productTile).toHaveClass("product-tile");
    expect(screen.getByTestId("current-order-rail")).toHaveAttribute("aria-label", "Current order");
    await userEvent.click(productTile);
    expect(screen.getByTestId("cart-Nyama Choma")).toHaveClass("order-line");
    expect(screen.getByTestId("cart-preview-total")).toHaveTextContent("9,999.99");

    await userEvent.click(screen.getByTestId("create-order"));
    expect(localSpies.addItem).toHaveBeenCalledWith({productId:"p1",quantity:1,modifierOptionIds:[]});
    expect(localSpies.commit).toHaveBeenCalled();
    expect(await screen.findByTestId("order-created")).toHaveTextContent("waiting to sync");
    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(addItemSpy).not.toHaveBeenCalled();
  });

  it("keeps local ordering available independently of the REST shift pointer", async () => {
    renderNewOrder();
    await screen.findByTestId("open-shift");
    expect(screen.getByTestId("create-order")).toBeInTheDocument();
  });
});
