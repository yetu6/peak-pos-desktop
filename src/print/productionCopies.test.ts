import { expect, it } from "vitest";
import { paperFor } from "../lib/printJobs";
import type { POSPrintJob } from "../lib/posContracts";
import { DEFAULT_PRINTER_SETTINGS } from "./printerSettings";
import { readable } from "./escpos";
const job:POSPrintJob={id:"copy-job",sourceType:"POS_ORDER",sourceId:"order",jobType:"KITCHEN_TICKET",status:"PENDING",attempts:0,createdAt:"",document:{dailyNumber:7,station:"BAR",items:[{name:"Water",quantity:2,fulfilment:"PICKED"}]}};
it.each(["system","thermal"])("configured station copies travel as one %s attempt, the extra pages numbered, never called reprints",kind=>{
 const settings={...DEFAULT_PRINTER_SETTINGS,stationCopies:{BAR:3},...(kind==="thermal"?{kitchen:{target:{kind:"network" as const,host:"127.0.0.1",port:9100},width:48 as const}}:{})};
 const paper=paperFor(job,{settings,printRaw:async()=>undefined});
 const text=paper.kind==="thermal"?readable(paper.bytes):paper.kind==="system"?paper.text:"";
 const pages=text.split("BAR ORDER").slice(1);
 expect(pages).toHaveLength(3);
 expect(pages[0]).not.toContain("COPY");
 expect(pages[1]).toContain("COPY 2 OF 3");
 expect(pages[2]).toContain("COPY 3 OF 3");
 expect(text).not.toMatch(/printed again/i);
 expect(job.document).not.toHaveProperty("copy");
});
