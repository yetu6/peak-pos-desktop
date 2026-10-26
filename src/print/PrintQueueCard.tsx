import { Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button } from "../components/system";
import { listPrintJobs } from "../lib/printJobs";
import type { POSPrintJob } from "../lib/posContracts";
import { retryPrintJob } from "./printFor";
import { getOperationalSession } from "../lib/operationalSession";
import { inspectNativePrint, usesNativePrintJournal } from "./nativePrintJournal";
import { confirmPaperNotPrinted, confirmPaperPrinted } from "./printResolution";
import { PRINT_RESOLUTION_WORDS } from "./printQueueWords";
import { PRINT_QUEUE_WORDS as words, queuedPaperName } from "./printQueueWords";

/** Explicit recovery only: never creates another sale, payment, refund or copy. */
export function PrintQueueCard() {
 const [jobs,setJobs]=useState<POSPrintJob[]|null>(null);
 const [problem,setProblem]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [unknownJob,setUnknownJob]=useState<POSPrintJob|null>(null);
 // Answers that arrive after the card has left the screen change nothing.
 const shown=useRef(true);
 useEffect(()=>{shown.current=true;return()=>{shown.current=false;};},[]);
 const refresh=useCallback(async()=>{
  try { const pages = await Promise.all([listPrintJobs("FAILED"), listPrintJobs("CLAIMED"), listPrintJobs("PENDING")]);
   if(!shown.current)return;
   const waiting = [...new Map(pages.flat().map(job => [job.id, job])).values()];
   setJobs(waiting.filter(job=>["PENDING","FAILED","CLAIMED"].includes(job.status))); }
  catch { if(shown.current)setProblem(words.loadFailed); }
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 async function retry(job:POSPrintJob) {
  setBusy(true);setProblem(null);
  try {
   const result=await retryPrintJob(job);
   if(!shown.current)return;
   if(!result.ok)setProblem(result.error??words.loadFailed);
   if(job.status === "CLAIMED" && usesNativePrintJournal() && (await inspectNativePrint(job.id))?.state === "unknown" && shown.current) setUnknownJob(job);
   await refresh();
  } catch {if(shown.current)setProblem(words.loadFailed);}
  finally{if(shown.current)setBusy(false);}
 }
 async function resolveObserved(printed:boolean) {
  if(!unknownJob)return;
  setBusy(true);
  try{await (printed?confirmPaperPrinted:confirmPaperNotPrinted)(unknownJob);if(!shown.current)return;setUnknownJob(null);setProblem(null);await refresh();}
  catch(error){if(shown.current)setProblem(error instanceof Error?error.message:words.loadFailed);}
  finally{if(shown.current)setBusy(false);}
 }
 return <section className="y-printers" aria-labelledby="print-queue-title" data-testid="print-queue">
  <h2 id="print-queue-title" className="y-status__name">{words.title}</h2>
  {problem?<div role="alert"><Banner inline tone="warning">{problem}</Banner></div>:null}
  {unknownJob?<div><p>{PRINT_RESOLUTION_WORDS.hint}</p><Button variant="secondary" disabled={busy} onClick={()=>void resolveObserved(true)}>{PRINT_RESOLUTION_WORDS.confirm}</Button><Button variant="secondary" disabled={busy} onClick={()=>void resolveObserved(false)}>{PRINT_RESOLUTION_WORDS.notPrinted}</Button></div>:null}
  {jobs===null?<p role="status">{words.checking}</p>:jobs.length===0?<p>{words.empty}</p>:<ul className="y-print-queue">
   {jobs.map(job=><li key={job.id}>
    <div><strong>{queuedPaperName(job)}</strong><p>{job.status==="FAILED"?words.failed:job.status==="CLAIMED"?words.claimed:words.pending}</p>{job.lastError?<p>{job.lastError}</p>:null}</div>
    <Button variant="secondary" icon={<Printer/>} disabled={busy || (job.status === "CLAIMED" && Boolean(job.claimedByTerminalId) && job.claimedByTerminalId !== getOperationalSession()?.terminalId)} onClick={()=>void retry(job)}>{busy?words.working:job.status==="CLAIMED"?words.check:words.retry}</Button>
   </li>)}
  </ul>}
  <Button variant="quiet" icon={<RefreshCw/>} disabled={busy} onClick={()=>void refresh()}>{words.refresh}</Button>
 </section>;
}
