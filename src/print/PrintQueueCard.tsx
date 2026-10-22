import { Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Banner, Button } from "../components/system";
import { listPrintJobs } from "../lib/printJobs";
import type { POSPrintJob } from "../lib/posContracts";
import { retryPrintJob } from "./printFor";
import { PRINT_QUEUE_WORDS as words, queuedPaperName } from "./printQueueWords";

/** Explicit recovery only: never creates another sale, payment, refund or copy. */
export function PrintQueueCard() {
 const [jobs,setJobs]=useState<POSPrintJob[]|null>(null);
 const [problem,setProblem]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{
  try { const pages = await Promise.all([listPrintJobs("FAILED"), listPrintJobs("CLAIMED"), listPrintJobs("PENDING")]);
   const waiting = [...new Map(pages.flat().map(job => [job.id, job])).values()];
   setJobs(waiting.filter(job=>["PENDING","FAILED","CLAIMED"].includes(job.status))); }
  catch { setProblem(words.loadFailed); }
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 async function retry(job:POSPrintJob) {
  setBusy(true);setProblem(null);
  try {
   const result=await retryPrintJob(job);
   if(!result.ok)setProblem(result.error??words.loadFailed);
   await refresh();
  } catch {setProblem(words.loadFailed);}
  finally{setBusy(false);}
 }
 return <section className="y-printers" aria-labelledby="print-queue-title" data-testid="print-queue">
  <h2 id="print-queue-title" className="y-status__name">{words.title}</h2>
  {problem?<Banner inline tone="warning">{problem}</Banner>:null}
  {jobs===null?<p role="status">{words.checking}</p>:jobs.length===0?<p>{words.empty}</p>:<ul className="y-print-queue">
   {jobs.map(job=><li key={job.id}>
    <div><strong>{queuedPaperName(job)}</strong><p>{job.status==="FAILED"?words.failed:job.status==="CLAIMED"?words.claimed:words.pending}</p>{job.lastError?<p>{job.lastError}</p>:null}</div>
    <Button variant="secondary" icon={<Printer/>} disabled={busy} onClick={()=>void retry(job)}>{busy?words.working:job.status==="CLAIMED"?words.check:words.retry}</Button>
   </li>)}
  </ul>}
  <Button variant="quiet" icon={<RefreshCw/>} disabled={busy} onClick={()=>void refresh()}>{words.refresh}</Button>
 </section>;
}
