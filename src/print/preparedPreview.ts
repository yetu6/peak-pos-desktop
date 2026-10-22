import { getOperationalSession } from "../lib/operationalSession";
import type { POSPaper, POSPrintJob } from "../lib/posContracts";
import { buildPaperFor, type TillPaper } from "../lib/printJobs";
import type { PrinterSettings } from "./printerSettings";

export type PreviewKind = "ROUND" | "AGAIN" | "BILL";
/** Advisory memory only; the server rechecks its own expiry and order version. */
export const PAPER_PREVIEW_TTL_MS = 300_000;
const MAX_PREPARED_PREVIEWS = 12;
type Prepared = { scope:string;orderId:string;kind:PreviewKind;token?:string;until:number;papers:Map<string,TillPaper> };
const prepared:Prepared[]=[];
function scope():string {
 const s=getOperationalSession();return [s?.propertyId,s?.outletId,s?.terminalId,s?.staffId].join("|");
}
function canonical(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
 if(value&&typeof value==="object")return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
 return JSON.stringify(value)??"null";
}
function key(paper:{jobType:string;document:Record<string,unknown>}):string {return `${paper.jobType}:${canonical(paper.document)}`;}
function clone(paper:TillPaper):TillPaper {
 return paper.kind==="thermal"?{...paper,target:{...paper.target},bytes:paper.bytes.slice()}:{...paper};
}
export function preparePreview(orderId:string,kind:PreviewKind,papers:readonly POSPaper[],settings:PrinterSettings,tagsOf?: (id:string)=>string|undefined,token?:string):void {
 const index=prepared.findIndex(p=>p.scope===scope()&&p.orderId===orderId&&p.kind===kind);if(index>=0)prepared.splice(index,1);
 const views=new Map<string,TillPaper>();
 for(const [i,paper] of papers.entries()) {
  const job:POSPrintJob={...paper,id:`preview-${i}`,sourceId:orderId,sourceType:"POS_ORDER",status:"ON_FILE",attempts:0,createdAt:""};
  views.set(key(paper),clone(buildPaperFor(job,{settings,printRaw:async()=>undefined,tagsOf})));
 }
 prepared.push({scope:scope(),orderId,kind,token,until:Date.now()+PAPER_PREVIEW_TTL_MS,papers:views});
 while(prepared.length>MAX_PREPARED_PREVIEWS)prepared.shift();
}
export function preparedPaper(job:POSPrintJob):TillPaper|undefined {
 for(const batch of [...prepared].reverse()) {
  if(batch.scope!==scope()||batch.orderId!==job.sourceId||batch.until<Date.now())continue;
  const paper=batch.papers.get(key(job));if(paper)return clone(paper);
 }
 return undefined;
}
export function previewTokenFor(orderId:string,kind:PreviewKind):string|undefined {
 return [...prepared].reverse().find(p=>p.scope===scope()&&p.orderId===orderId&&p.kind===kind&&p.until>=Date.now())?.token;
}
export function clearPreparedPreviews():void {prepared.length=0;}

const receivedTokens = new Map<string, {token:string;until:number}>();
function tokenKey(orderId:string,kind:PreviewKind):string {return `${scope()}|${orderId}|${kind}`;}
export function rememberPreviewToken(orderId:string,kind:PreviewKind,token?:string):void {
 const key=tokenKey(orderId,kind);receivedTokens.delete(key);
 if(token)receivedTokens.set(key,{token,until:Date.now()+PAPER_PREVIEW_TTL_MS});
 while(receivedTokens.size>MAX_PREPARED_PREVIEWS)receivedTokens.delete(receivedTokens.keys().next().value!);
}
export function receivedPreviewToken(orderId:string,kind:PreviewKind):string|undefined {
 const value=receivedTokens.get(tokenKey(orderId,kind));return value&&value.until>=Date.now()?value.token:undefined;
}
