/** Local-only acceptance: actual paper builders -> native raw TCP -> decoded preview. */
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { paperFor } from "../src/lib/printJobs";
import { readable } from "../src/print/escpos";
import { paperViews } from "../src/print/paperPreview";
import { DEFAULT_PRINTER_SETTINGS } from "../src/print/printerSettings";
import { ORDER } from "../src/visual/registerData";
import { FIXTURE_PLACE } from "../src/visual/fixturePlace";
import type { POSPrintJob } from "../src/lib/posContracts";

const temporary=await mkdtemp(join(tmpdir(),"yetu-paper-standin-"));
try {
 const source=join(temporary,"send.rs"), binary=join(temporary,"send");
 await writeFile(source,`#[allow(dead_code)] #[path = ${JSON.stringify(resolve("src-tauri/src/raw_print.rs"))}] mod raw_print;
use std::io::Read;
fn main() { let mut bytes=Vec::new();std::io::stdin().read_to_end(&mut bytes).unwrap();raw_print::print_raw(&raw_print::RawTarget::Network{host:"127.0.0.1".into(),port:9100},&bytes).unwrap(); }`);
 const built=spawnSync("rustc",["--edition=2021",source,"-o",binary],{encoding:"utf8"});assert.equal(built.status,0,built.stderr);
 const context={orderId:ORDER.id,orderNumber:ORDER.orderNumber,dailyNumber:ORDER.dailyNumber,serviceType:ORDER.serviceType,tableLabel:ORDER.tableLabel,waiterName:ORDER.initiatedByName,sentAt:ORDER.createdAt,station:"BAR",roundNumber:2};
 const bill={...context,propertyName:FIXTURE_PLACE.propertyName,outletName:FIXTURE_PLACE.outletName,kind:"BILL",currency:"TZS",items:ORDER.items,subtotalMinor:ORDER.subtotalMinor,taxMinor:ORDER.taxMinor,totalMinor:ORDER.totalMinor,remainingMinor:ORDER.totalMinor,printedAt:ORDER.createdAt};
 const documents=[
  {name:"bar",jobType:"KITCHEN_TICKET",document:{...context,items:[{name:"Water",quantity:2,fulfilment:"PICKED"},{name:"Coffee",quantity:1,fulfilment:"PREPARED"}]}},
  {name:"bill",jobType:"BILL",document:bill},
  {name:"paid-copy",jobType:"RECEIPT",reprintedFromId:"original-bill",document:{...bill,kind:undefined,copy:true,printedAgainByName:ORDER.initiatedByName,printedAgainAt:ORDER.createdAt}},
  {name:"cancel",jobType:"KITCHEN_VOID",document:{...context,items:[{name:"Water",quantity:1}],voidedAt:ORDER.createdAt,reason:"Entered by mistake",askedByName:ORDER.initiatedByName,approvedByName:"Manager"}},
  {name:"refund",jobType:"REFUND_RECEIPT",document:{...context,propertyName:FIXTURE_PLACE.propertyName,outletName:FIXTURE_PLACE.outletName,currency:"TZS",lines:[{name:ORDER.items[0].name,quantity:1,totalMinor:ORDER.items[0].unitPriceMinor}],totalMinor:ORDER.items[0].unitPriceMinor,tenders:[{paymentMethod:"CASH",amountMinor:ORDER.items[0].unitPriceMinor}],reason:"Returned",refundedAt:ORDER.createdAt}},
 ];
 for(const width of [32,48] as const)for(const [index,doc] of documents.entries()){
  const printer={target:{kind:"network" as const,host:"127.0.0.1",port:9100},width};
  const settings={...DEFAULT_PRINTER_SETTINGS,kitchen:printer,receipt:printer};
  const job:POSPrintJob={...doc,id:`standin-${index}`,sourceType:"POS_ORDER",sourceId:ORDER.id,status:"CLAIMED",attempts:1,createdAt:ORDER.createdAt!};
  const paper=paperFor(job,{settings,printRaw:async()=>undefined});assert.equal(paper.kind,"thermal");if(paper.kind!=="thermal")throw new Error("Expected thermal paper");
  const chunks:Buffer[]=[];let finish!:(v:Buffer)=>void;const received=new Promise<Buffer>(r=>finish=r);
  const server=createServer(socket=>{socket.on("data",data=>chunks.push(data));socket.on("end",()=>finish(Buffer.concat(chunks)));});
  await new Promise<void>((done,reject)=>{server.once("error",reject);server.listen(9100,"127.0.0.1",done);});
  try{
   const sent=spawnSync(binary,[],{input:paper.bytes,timeout:15000});assert.equal(sent.status,0,sent.stderr?.toString());
   const bytes=await Promise.race([received,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("Stand-in did not receive paper")),15000).unref())]);assert.deepEqual(bytes,Buffer.from(paper.bytes));
   const text=readable(bytes);assert.ok(text.includes("Powered by Yetu-FBC"));assert.ok(text.trimEnd().endsWith("Powered by Yetu-FBC"));
   if(doc.jobType==="BILL"||doc.jobType==="KITCHEN_TICKET")assert.equal(text,paperViews([{jobType:doc.jobType,document:doc.document}],settings)[0].text);
   if(doc.name==="paid-copy")assert.ok(text.includes("COPY"));
   console.log(`${width===48?"80":"58"} mm ${doc.name}: exact bytes and decoded paper passed`);
  }finally{await new Promise<void>(done=>server.close(()=>done()));}
 }
} finally {await rm(temporary,{recursive:true,force:true});}
