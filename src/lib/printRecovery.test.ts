import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { processPrintJob } from "./printJobs";
import type { POSPrintJob } from "./posContracts";

const native = vi.hoisted(()=>({enabled:false,inspect:vi.fn(),send:vi.fn()}));
vi.mock("../print/nativePrintJournal",()=>({usesNativePrintJournal:()=>native.enabled,inspectNativePrint:native.inspect,nativePrintOnce:native.send}));
beforeEach(()=>{native.enabled=false;native.inspect.mockReset();native.send.mockReset();});
const job: POSPrintJob = { id:"recover-paper",sourceType:"POS_ORDER",sourceId:"order-recovery",jobType:"KITCHEN_TICKET",document:{dailyNumber:7,items:[{name:"Soda",quantity:1}]},status:"PENDING",attempts:0,createdAt:"" };
const reply = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
afterEach(()=>vi.unstubAllGlobals());

it("a failed job must be claimed again with a new attempt key before sending", async()=>{
 const calls:{url:string;key:string|null;body:unknown}[]=[];
 vi.stubGlobal("fetch",vi.fn(async(input:string,init?:RequestInit)=>{
  const url=String(input);calls.push({url,key:new Headers(init?.headers).get("Idempotency-Key"),body:init?.body?JSON.parse(String(init.body)):undefined});
  if(url.endsWith("/claim"))return reply({...job,status:"CLAIMED",attempts:2});
  return reply({...job,status:"PRINTED",attempts:2});
 }));
 const print=vi.fn(async()=>undefined);
 expect(await processPrintJob({...job,status:"FAILED",attempts:1},print)).toEqual({ok:true});
 expect(calls[0].url).toMatch(/\/claim$/);
 expect(calls[0].key).toBe("pos-print-job:recover-paper:claim:2");
 expect(calls[1].key).toBe("pos-print-job:recover-paper:printed:2");
 expect(calls[1].body).toEqual({attempt:2});
 expect(print).toHaveBeenCalledTimes(1);
});

it("an acknowledgement failure never marks an accepted paper failed", async()=>{
 const calls:string[]=[];
 vi.stubGlobal("fetch",vi.fn(async(input:string)=>{
  const url=String(input);calls.push(url);
  if(url.endsWith("/claim"))return reply({...job,status:"CLAIMED",attempts:1});
  return reply({message:"Connection lost"},503);
 }));
 const print=vi.fn(async()=>undefined);
 const result=await processPrintJob(job,print);
 expect(result.ok).toBe(false);
 expect(result.error).toContain("accepted");
 expect(calls.some(url=>url.endsWith("/failed"))).toBe(false);
 expect(print).toHaveBeenCalledTimes(1);
});

it.each(["PRINTED","ON_FILE"] as const)("does not send %s jobs to a printer",async(status)=>{
 const print=vi.fn(async()=>undefined);const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 expect(await processPrintJob({...job,status},print)).toEqual({ok:true});
 expect(print).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});


it("after restart, accepted native evidence retries only the server acknowledgement",async()=>{
 native.enabled=true;native.inspect.mockResolvedValue({state:"accepted",attempt:1,jobId:job.id});
 const urls:string[]=[];vi.stubGlobal("fetch",vi.fn(async(input:string)=>{urls.push(String(input));return reply({...job,status:"PRINTED",attempts:1});}));
 const print=vi.fn(async()=>undefined);
 expect(await processPrintJob({...job,status:"CLAIMED",attempts:1},print)).toEqual({ok:true});
 expect(urls).toHaveLength(1);expect(urls[0]).toMatch(/\/printed$/);
 expect(native.send).not.toHaveBeenCalled();expect(print).not.toHaveBeenCalled();
});
it("ambiguous native dispatch stays claimed and asks for a manual paper check",async()=>{
 native.enabled=true;native.inspect.mockResolvedValue({state:"unknown",attempt:1,jobId:job.id});
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);const print=vi.fn(async()=>undefined);
 const result=await processPrintJob({...job,status:"CLAIMED",attempts:1},print);
 expect(result.ok).toBe(false);expect(result.error).toContain("Check the printer");
 expect(fetch).not.toHaveBeenCalled();expect(native.send).not.toHaveBeenCalled();expect(print).not.toHaveBeenCalled();
});
it("a known connection refusal can be retried, using the same financial job",async()=>{
 native.enabled=true;native.inspect.mockResolvedValue(null);native.send.mockResolvedValue({state:"not_sent",attempt:1,message:"Printer did not answer"});
 const urls:string[]=[];vi.stubGlobal("fetch",vi.fn(async(input:string)=>{urls.push(String(input));return reply({...job,status:String(input).endsWith("/claim")?"CLAIMED":"FAILED",attempts:1});}));
 const result=await processPrintJob(job);
 expect(result).toEqual({ok:false,error:"Printer did not answer"});
 expect(urls.some(url=>url.endsWith("/failed"))).toBe(true);
 expect(native.send).toHaveBeenCalledWith(job.id,1,expect.objectContaining({kind:"system"}));
});

it("does not recover a job claimed by another terminal",async()=>{
 const {setOperationalSession,clearOperationalSession}=await import("./operationalSession");
 setOperationalSession({token:"test",expiresAt:"",tenantId:"tenant",propertyId:"property",outletId:"outlet",terminalId:"mine",staffId:"staff",assurance:"RESTRICTED"});
 try {
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);const print=vi.fn(async()=>undefined);
  expect(await processPrintJob({...job,status:"CLAIMED",attempts:1,claimedByTerminalId:"other"},print)).toEqual({ok:true});
  expect(fetch).not.toHaveBeenCalled();expect(print).not.toHaveBeenCalled();
 } finally {clearOperationalSession();}
});

it("system paid-bill copies retain references and carry a COPY mark",async()=>{
 const {formatPrintDocument}=await import("./printJobs");
 const document={propertyName:"Bahari",orderNumber:"POS-7",dailyNumber:7,totalMinor:500000,currency:"TZS",items:[{name:"Rice",quantity:1,totalMinor:500000}]};
 const {text}=formatPrintDocument({...job,jobType:"RECEIPT",document,reprintedFromId:"original",createdAt:"2026-10-22T14:00:00Z"});
 expect(text).toContain("COPY");expect(text).toContain("Ref POS-7");expect(text).toContain("TSh 5,000");
 expect(document).not.toHaveProperty("copy");
});
