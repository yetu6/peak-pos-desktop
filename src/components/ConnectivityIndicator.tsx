import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useRealtime} from "../realtime/RealtimeProvider";
import {Dialog,DialogContent,DialogDescription,DialogTitle} from "./ui/dialog";
import {loadLocalPosCore} from "../lib/localPosCore";
import {getOperationalSession} from "../lib/operationalSession";
import {getApiBaseUrl} from "../lib/peakConfig";

const LABELS:Record<string,string>={connecting:"Connecting",connected:"Live",reconnecting:"Reconnecting",disconnected:"Offline",error:"Realtime error"};
interface RealtimeState {phase:string;attempt:number;resyncGeneration:number;lastError:string|null}

export function ConnectivityIndicator(){
  const {state}=useRealtime();
  const native=typeof window!=="undefined"&&"__TAURI_INTERNALS__" in window;
  return native?<NativeConnectivityIndicator state={state}/>:<StatusButton state={state}/>;
}

function StatusButton({state,label,tone,onClick}:{state:RealtimeState;label?:string;tone?:string;onClick?:()=>void}){
  const realtimeTone=state.phase==="connected"?"live":state.phase==="connecting"||state.phase==="reconnecting"?"alert":"down";
  const visibleLabel=label??LABELS[state.phase]??state.phase;
  return <button className={`shift-pill ${tone??realtimeTone}`} data-testid="connectivity" role="status" aria-live="polite" onClick={onClick} aria-label={`Connection status: ${visibleLabel}${state.phase==="reconnecting"&&state.attempt>0?`, attempt ${state.attempt}`:""}`} title={state.lastError??`resync generation ${state.resyncGeneration}, attempt ${state.attempt}`}>
    <span className="dot" data-testid="conn-dot"/><span data-testid="conn-label">{visibleLabel}</span>
    {state.phase==="reconnecting"&&state.attempt>0&&<span className="opacity-70">#{state.attempt}</span>}
  </button>;
}

function NativeConnectivityIndicator({state}:{state:RealtimeState}){
  const [open,setOpen]=useState(false);
  const queryClient=useQueryClient();
  const sync=useQuery({queryKey:["local-pos","sync"],queryFn:async()=>(await loadLocalPosCore()).syncState(),refetchInterval:5000,retry:false});
  const local=sync.data;
  const label=local?(local.status==="Offline"?`Offline · ${local.queuedOperations} waiting`:local.status):(LABELS[state.phase]??state.phase);
  const tone=local?.status==="Live"?"live":local?.status==="Sync issue"?"down":"alert";
  async function retry(){const session=getOperationalSession();if(!session)return;const core=await loadLocalPosCore();const next=await core.retrySync(getApiBaseUrl(),session.token);queryClient.setQueryData(["local-pos","sync"],next)}
  return <>
    <StatusButton state={state} label={label} tone={tone} onClick={()=>setOpen(true)}/>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="terminal-dialog w-[min(520px,calc(100vw-32px))] max-w-none p-5"><DialogTitle>Sync Center</DialogTitle><DialogDescription>Local financial evidence remains on this terminal after acknowledgement.</DialogDescription>
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-[var(--surface-raised)] p-4 text-sm"><dt>Last synchronization</dt><dd>{local?.lastSuccessAtMs?new Date(local.lastSuccessAtMs).toLocaleString():"Not yet"}</dd><dt>Queued operations</dt><dd>{local?.queuedOperations??0}</dd><dt>Reconciled operations</dt><dd>{local?.reconciledOperations??0}</dd><dt>Exception / review</dt><dd>{local?.exceptionOperations??0}</dd><dt>Lease</dt><dd>{local?.leaseStatus??"Unavailable"}</dd><dt>Catalog</dt><dd>{local?.catalogStatus??"Unavailable"}</dd><dt>Offline shift eligibility</dt><dd>{local?.shiftOfflineEligible?"Eligible":"Not eligible"}</dd></dl>
      <button className="btn-primary" disabled={sync.isFetching} onClick={()=>void retry()}>{sync.isFetching?"Checking…":"Retry synchronization"}</button>
    </DialogContent></Dialog>
  </>;
}
