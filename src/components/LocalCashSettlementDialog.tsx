import {useState} from "react";
import {Dialog,DialogContent,DialogDescription,DialogTitle} from "./ui/dialog";
import {MoneyDisplay} from "./terminal/TerminalPrimitives";
import {formatMinor} from "../lib/posMoney";
import type {OfflineCashCommitResult} from "../lib/localPosCore";

export function LocalCashSettlementDialog({amountDueMinor,currency,busy,error,onCancel,onConfirm}:{amountDueMinor:number;currency:string;busy:boolean;error:boolean;onCancel:()=>void;onConfirm:(cashReceivedMinor:number)=>void}){
  const [received,setReceived]=useState(String(amountDueMinor));
  const value=/^\d+$/.test(received)?Number(received):NaN;
  const valid=Number.isSafeInteger(value)&&value>=amountDueMinor;
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onCancel()}}><DialogContent className="terminal-dialog w-[min(480px,calc(100vw-32px))] max-w-none p-5" showCloseButton={false}>
    <DialogTitle className="text-lg font-bold">Cash settlement</DialogTitle>
    <DialogDescription>Cash physically received will be committed to this terminal before synchronization.</DialogDescription>
    <div className="settlement-due"><span>Amount due</span><MoneyDisplay prominence="strong">{formatMinor(amountDueMinor,currency)}</MoneyDisplay></div>
    <label className="space-y-2 text-xs font-semibold text-[var(--foreground-muted)]">Cash received · smallest currency unit
      <input autoFocus data-testid="offline-cash-received" inputMode="numeric" pattern="[0-9]*" value={received} onChange={event=>setReceived(event.target.value)} className="input mt-2 w-full text-lg"/>
    </label>
    {error&&<div className="badge badge-danger">Cash was not committed. No saved-sale confirmation has been issued.</div>}
    <div className="mt-3 flex justify-end gap-2"><button className="btn-tertiary btn-sm" disabled={busy} onClick={onCancel}>Cancel</button><button data-testid="confirm-offline-cash" className="btn-primary btn-sm" disabled={!valid||busy} onClick={()=>onConfirm(value)}>{busy?"Saving cash…":"Confirm cash"}</button></div>
  </DialogContent></Dialog>
}

export function LocalCashSaved({result,currency}:{result:OfflineCashCommitResult;currency:string}){
  return <div className="badge badge-success mt-3" role="status" data-testid="offline-cash-saved">Cash sale saved locally · Change <strong>{formatMinor(result.changeMinor,currency)}</strong> · {result.syncState==="QUEUED"?"waiting to sync":"synchronized"}</div>
}
