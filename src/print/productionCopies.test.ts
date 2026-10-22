import { expect, it } from "vitest";
import { paperFor } from "../lib/printJobs";
import type { POSPrintJob } from "../lib/posContracts";
import { DEFAULT_PRINTER_SETTINGS } from "./printerSettings";
import { readable } from "./escpos";
const job:POSPrintJob={id:"copy-job",sourceType:"POS_ORDER",sourceId:"order",jobType:"KITCHEN_TICKET",status:"PENDING",attempts:0,createdAt:"",document:{dailyNumber:7,station:"BAR",items:[{name:"Water",quantity:2,fulfilment:"PICKED"}]}};
it.each(["system","thermal"])("configured station copies travel as one %s attempt with extra pages marked COPY",kind=>{
 const settings={...DEFAULT_PRINTER_SETTINGS,stationCopies:{BAR:3},...(kind==="thermal"?{kitchen:{target:{kind:"network" as const,host:"127.0.0.1",port:9100},width:48 as const}}:{})};
 const paper=paperFor(job,{settings,printRaw:async()=>undefined});
 const text=paper.kind==="thermal"?readable(paper.bytes):paper.kind==="system"?paper.text:"";
 expect(text.split("BAR ORDER")).toHaveLength(4);
 expect((text.match(/COPY/g)??[])).toHaveLength(2);
 expect(job.document).not.toHaveProperty("copy");
});
