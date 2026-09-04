import {useEffect,useState} from "react";
import {Icon} from "../components/Icon";
import {TillControls} from "../components/TillControls";
import {ItemModifierDialog,type ModifierSelection} from "../components/ItemModifierDialog";
import {CategoryTab,MoneyDisplay,OrderLine,OrderRail,ProductTile,QuantityStepper,TerminalState} from "../components/terminal/TerminalPrimitives";
import {useLocalCatalog,useLocalDraft} from "../hooks/useLocalOrder";
import type {LocalCatalogProduct} from "../lib/localPosCore";
import {formatMinor} from "../lib/posMoney";
import {LocalCashSaved,LocalCashSettlementDialog} from "../components/LocalCashSettlementDialog";
import type {OfflineCashCommitResult} from "../lib/localPosCore";

export function NewOrder(){
  const [activeCategory,setActiveCategory]=useState<string|undefined>();
  const [search,setSearch]=useState("");
  const catalog=useLocalCatalog(search,activeCategory);
  const {draft,addItem,setQuantity,removeLine,updateContext,commit,settleCash}=useLocalDraft(catalog.data?.serviceTypes[0]?.id);
  const [serviceType,setServiceType]=useState("");
  const [tableLabel,setTableLabel]=useState("");
  const [notes,setNotes]=useState("");
  const [configuring,setConfiguring]=useState<LocalCatalogProduct|null>(null);
  const [secured,setSecured]=useState<string|null>(null);
  const [cashOpen,setCashOpen]=useState(false);
  const [cashSaved,setCashSaved]=useState<OfflineCashCommitResult|null>(null);
  const order=draft.data;
  useEffect(()=>{if(order){setServiceType(order.serviceType);setTableLabel(order.tableLabel??"");setNotes(order.notes??"")}},[order?.id]);
  const effectiveServiceType=serviceType||order?.serviceType||catalog.data?.serviceTypes[0]?.id||"";
  const currency=catalog.data?.currency??order?.currency??"TZS";

  function tapProduct(product:LocalCatalogProduct){setSecured(null);if(product.modifierGroups.length>0)setConfiguring(product);else addItem.mutate({productId:product.id,quantity:1,modifierOptionIds:[]})}
  function confirmModifiers(product:LocalCatalogProduct,selection:ModifierSelection){addItem.mutate({productId:product.id,quantity:selection.quantity,modifierOptionIds:selection.modifierOptionIds},{onSuccess:()=>setConfiguring(null)})}
  function persistContext(nextService=effectiveServiceType){if(!order||!nextService)return;updateContext.mutate({serviceType:nextService,tableLabel:tableLabel.trim()||undefined,notes:notes.trim()||undefined})}
  function secureOrder(){commit.mutate(undefined,{onSuccess:(result)=>{setSecured(result.id);setTableLabel("");setNotes("");void draft.refetch()}})}
  const busy=addItem.isPending||setQuantity.isPending||removeLine.isPending||updateContext.isPending||commit.isPending||Boolean(settleCash?.isPending);
  const totalItems=order?.lines.reduce((sum,line)=>sum+line.quantity,0)??0;
  const error=catalog.error??draft.error??addItem.error??setQuantity.error??removeLine.error??updateContext.error??commit.error;

  return <div className="new-order-screen">
    <div className="new-order-header"><div><h1 className="text-lg font-bold tracking-[-0.02em] text-[var(--foreground)]">New order</h1><p className="text-xs text-[var(--foreground-muted)]">Local-first ordering · prices secured by the active Peak catalog</p></div><TillControls currency={currency}/></div>
    <div className="new-order-layout">
      <section className="catalog-workspace" aria-label="Catalog">
        <div className="catalog-toolbar">
          {(catalog.data?.serviceTypes??[]).map(type=><CategoryTab key={type.id} data-testid={`service-type-${type.id}`} active={effectiveServiceType===type.id} disabled={busy} onClick={()=>{setServiceType(type.id);persistContext(type.id)}}>{type.label}</CategoryTab>)}
          <label className="relative ml-auto min-w-44"><span className="sr-only">Search menu</span><input data-testid="catalog-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search menu" className="input w-full"/></label>
          <input data-testid="table-label" value={tableLabel} onChange={event=>setTableLabel(event.target.value)} onBlur={()=>persistContext()} placeholder="Table / context" className="input w-40"/>
        </div>
        {(catalog.data?.categories.length??0)>0&&<div className="category-tabs" aria-label="Menu categories"><CategoryTab data-testid="category-all" active={!activeCategory} onClick={()=>setActiveCategory(undefined)}>All</CategoryTab>{catalog.data!.categories.map(category=><CategoryTab key={category.id} data-testid={`category-${category.id}`} active={activeCategory===category.id} onClick={()=>setActiveCategory(category.id)}>{category.name}</CategoryTab>)}</div>}
        {(catalog.isLoading||draft.isLoading)&&<div className="skeleton h-40 w-full rounded-xl"/>}
        {(catalog.isError||draft.isError)&&<TerminalState state="offline" title="Certified menu unavailable" description="Ordering is locked until this terminal has a valid signed catalog, shift and offline authorization lease."/>}
        {!catalog.isLoading&&!catalog.isError&&catalog.data?.products.length===0&&<TerminalState state="empty" title="No matching items" description="Try another category or search term."/>}
        <div className="product-grid">{catalog.data?.products.map(product=><ProductTile key={product.id} data-testid={`menu-${product.name}`} disabled={!order||busy} onClick={()=>tapProduct(product)} name={product.name} price={formatMinor(product.priceMinor,product.currency)}/>)}</div>
      </section>
      <OrderRail title="Current order" data-testid="current-order-rail" headerMeta={<p className="mt-1 text-xs text-[var(--foreground-muted)]">{totalItems} {totalItems===1?"item":"items"} · {order?.syncState==="LOCAL_DRAFT"?"Saved locally":"Secured"}</p>} footer={<>
        <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-[var(--foreground-muted)]"><span>Subtotal</span><MoneyDisplay className="text-right">{order?formatMinor(order.subtotalMinor,currency):"—"}</MoneyDisplay><span>Tax</span><MoneyDisplay className="text-right">{order?formatMinor(order.taxMinor,currency):"—"}</MoneyDisplay><span className="font-semibold text-[var(--foreground)]">Total</span><MoneyDisplay prominence="strong" className="text-right text-base" data-testid="cart-preview-total">{order&&order.lines.length>0?formatMinor(order.totalMinor,currency):"—"}</MoneyDisplay></div>
        <input data-testid="order-notes" value={notes} onChange={event=>setNotes(event.target.value)} onBlur={()=>persistContext()} placeholder="Order notes" className="input w-full"/>
        {secured&&<div className="badge badge-success mt-3" data-testid="order-created">Order secured locally · waiting to sync</div>}
        {cashSaved&&<LocalCashSaved result={cashSaved} currency={currency}/>}
        {error&&<div className="badge badge-danger mt-3" data-testid="create-error">Intent not saved. Review terminal authorization and try again.</div>}
        <div className="mt-4 grid grid-cols-2 gap-2"><button data-testid="create-order" onClick={secureOrder} disabled={!order||order.lines.length===0||busy} className="btn-secondary w-full"><Icon name="orders" size={17}/>{commit.isPending?"Securing…":"Secure order"}</button><button data-testid="settle-local-cash" onClick={()=>setCashOpen(true)} disabled={!order||order.lines.length===0||busy} className="btn-primary w-full">Settle cash</button></div>
      </>}>
        <ul>{(!order||order.lines.length===0)&&<li className="py-8 text-center text-xs text-[var(--foreground-muted)]">Tap a menu item to start this order.</li>}{order?.lines.map(line=><OrderLine key={line.id} data-testid={`cart-${line.name}`}><span className="min-w-0 flex-1"><span className="block truncate font-semibold text-[var(--foreground)]">{line.name}</span>{line.modifiers.length>0&&<span className="block truncate text-[11px] text-[var(--foreground-muted)]">{line.modifiers.map(item=>item.name).join(", ")}</span>}<MoneyDisplay className="mt-1 block text-[11px] text-[var(--foreground-muted)]">{formatMinor(line.lineTotalMinor,currency)}</MoneyDisplay></span><QuantityStepper label={line.name} value={line.quantity} minimum={0} onDecrease={()=>line.quantity===1?removeLine.mutate(line.id):setQuantity.mutate({lineId:line.id,quantity:line.quantity-1})} onIncrease={()=>setQuantity.mutate({lineId:line.id,quantity:line.quantity+1})}/></OrderLine>)}</ul>
      </OrderRail>
    </div>
    {configuring&&<ItemModifierDialog product={configuring} currency={configuring.currency} onCancel={()=>setConfiguring(null)} onConfirm={selection=>confirmModifiers(configuring,selection)}/>}
    {cashOpen&&order&&settleCash&&<LocalCashSettlementDialog amountDueMinor={order.totalMinor} currency={currency} busy={settleCash.isPending} error={settleCash.isError} onCancel={()=>setCashOpen(false)} onConfirm={amount=>settleCash.mutate(amount,{onSuccess:result=>{setCashSaved(result);setCashOpen(false);setTableLabel("");setNotes("");void draft.refetch()}})}/>}
  </div>
}
