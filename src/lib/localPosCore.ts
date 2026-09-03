export interface SignedCatalogSnapshot {
  keyId: string;
  digest: string;
  payloadB64: string;
  signatureB64: string;
}

export interface CatalogActivationResult {
  state: "ACTIVE";
  snapshotId: string;
  version: string;
  digest: string;
  productCount: number;
}

export interface LocalCatalogModifierOption { id: string; name: string; priceDeltaMinor: number }
export interface LocalCatalogModifierGroup { id: string; name: string; minSelect: number; maxSelect: number; options: LocalCatalogModifierOption[] }
export interface LocalCatalogProduct { id: string; categoryId?: string; code: string; name: string; priceMinor: number; taxRateBp: number; currency: string; modifierGroups: LocalCatalogModifierGroup[] }
export interface LocalCatalogView { snapshotId: string; version: string; currency: string; taxMode: "EXCLUSIVE" | "INCLUSIVE"; serviceTypes: Array<{id:string;label:string;requiresContext:boolean}>; categories: Array<{id:string;code:string;name:string}>; products: LocalCatalogProduct[] }
export interface LocalOrderModifierView { id:string;optionId:string;name:string;priceDeltaMinor:number }
export interface LocalOrderLineView { id:string;productId:string;name:string;quantity:number;unitPriceMinor:number;modifierTotalMinor:number;lineTotalMinor:number;pricing:{unitNetMinor:number;unitTaxMinor:number;unitTotalMinor:number;lineSubtotalMinor:number;lineTaxMinor:number;lineTotalMinor:number};modifiers:LocalOrderModifierView[] }
export interface LocalOrderView { id:string;state:"DRAFT"|"COMMITTED";syncState:"LOCAL_DRAFT"|"SYNC_PENDING"|"ACKNOWLEDGED"|"MANUAL_REVIEW";version:number;staffId:string;serviceType:string;tableLabel?:string;notes?:string;currency:string;subtotalMinor:number;taxMinor:number;totalMinor:number;orderNumber?:string;lines:LocalOrderLineView[] }

type Invoke=(command:string,args?:Record<string,unknown>)=>Promise<unknown>;
export interface LocalPosCore {
  installCatalog(envelope:SignedCatalogSnapshot):Promise<CatalogActivationResult>;
  catalog(query?:string,categoryId?:string):Promise<LocalCatalogView>;
  getOrCreateDraft(intent:{serviceType:string;tableLabel?:string;notes?:string}):Promise<LocalOrderView>;
  updateContext(intent:{orderId:string;expectedVersion:number;serviceType:string;tableLabel?:string;notes?:string}):Promise<LocalOrderView>;
  addItem(intent:{orderId:string;expectedVersion:number;productId:string;quantity:number;modifierOptionIds:string[]}):Promise<LocalOrderView>;
  setQuantity(orderId:string,lineId:string,quantity:number,expectedVersion:number):Promise<LocalOrderView>;
  removeLine(orderId:string,lineId:string,expectedVersion:number):Promise<LocalOrderView>;
  getOrder(orderId:string):Promise<LocalOrderView>;
  commitOrder(orderId:string,expectedVersion:number):Promise<LocalOrderView>;
}
export function createLocalPosCore(invoke:Invoke):LocalPosCore{return{
  installCatalog:(envelope)=>invoke("install_catalog_snapshot",{envelope}) as Promise<CatalogActivationResult>,
  catalog:(query,categoryId)=>invoke("get_local_catalog",{query,categoryId}) as Promise<LocalCatalogView>,
  getOrCreateDraft:(intent)=>invoke("get_or_create_order_draft",{intent}) as Promise<LocalOrderView>,
  updateContext:(intent)=>invoke("update_order_context",{intent}) as Promise<LocalOrderView>,
  addItem:(intent)=>invoke("add_local_order_item",{intent}) as Promise<LocalOrderView>,
  setQuantity:(orderId,lineId,quantity,expectedVersion)=>invoke("set_local_order_line_quantity",{orderId,lineId,quantity,expectedVersion}) as Promise<LocalOrderView>,
  removeLine:(orderId,lineId,expectedVersion)=>invoke("remove_local_order_line",{orderId,lineId,expectedVersion}) as Promise<LocalOrderView>,
  getOrder:(orderId)=>invoke("get_local_order",{orderId}) as Promise<LocalOrderView>,
  commitOrder:(orderId,expectedVersion)=>invoke("commit_local_order",{orderId,expectedVersion}) as Promise<LocalOrderView>,
}}
export async function loadLocalPosCore():Promise<LocalPosCore>{const {invoke}=await import("@tauri-apps/api/core");return createLocalPosCore(invoke)}
