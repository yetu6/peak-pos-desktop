import { afterEach, expect, it } from "vitest";
import { preparePreview, preparedPaper, previewTokenFor, clearPreparedPreviews } from "./preparedPreview";
import { setOperationalSession, clearOperationalSession } from "../lib/operationalSession";
import { DEFAULT_PRINTER_SETTINGS } from "./printerSettings";
import type { POSPaper, POSPrintJob } from "../lib/posContracts";
const paper:POSPaper={jobType:"KITCHEN_TICKET",document:{orderId:"order",dailyNumber:7,station:"BAR",items:[{name:"Soda",quantity:2,fulfilment:"PICKED"}]}};
const job={...paper,id:"job",status:"PENDING",sourceType:"POS_ORDER",sourceId:"order",attempts:0,createdAt:""} as POSPrintJob;
const session={token:"test",expiresAt:"",tenantId:"tenant",propertyId:"property",outletId:"outlet",terminalId:"terminal",staffId:"staff",assurance:"RESTRICTED" as const};
afterEach(()=>{clearPreparedPreviews();clearOperationalSession();});
it("freezes the preview paper and printer target until confirmation",()=>{
 setOperationalSession(session);
 const settings={...DEFAULT_PRINTER_SETTINGS,stations:{BAR:{width:32 as const,target:{kind:"network" as const,host:"127.0.0.1",port:9100}}}};
 preparePreview("order","ROUND",[paper],settings,undefined,"token");
 const before=preparedPaper(job);
 expect(before).toMatchObject({kind:"thermal",width:32,target:{host:"127.0.0.1"}});
 settings.stations.BAR.width=48 as 32;settings.stations.BAR.target.host="192.168.1.2";
 expect(preparedPaper(job)).toEqual(before);
 expect(previewTokenFor("order","ROUND")).toBe("token");
});
it("does not reuse a preview across staff, outlets, changed documents or paper kinds",()=>{
 setOperationalSession(session);preparePreview("order","ROUND",[paper],DEFAULT_PRINTER_SETTINGS,undefined,"token");
 expect(preparedPaper({...job,document:{...paper.document,dailyNumber:8}})).toBeUndefined();
 expect(previewTokenFor("order","BILL")).toBeUndefined();
 setOperationalSession({...session,staffId:"other"});expect(preparedPaper(job)).toBeUndefined();
 expect(previewTokenFor("order","ROUND")).toBeUndefined();
 setOperationalSession({...session,outletId:"other"});expect(preparedPaper(job)).toBeUndefined();
});

it("expired signed previews retain their token so the server refuses instead of printing unbound",async()=>{
 const {vi}=await import("vitest");const {rememberPreviewToken,receivedPreviewToken,PAPER_PREVIEW_TTL_MS}=await import("./preparedPreview");
 vi.useFakeTimers();
 try{setOperationalSession(session);rememberPreviewToken("order","BILL","expired-token");vi.advanceTimersByTime(PAPER_PREVIEW_TTL_MS+1);
 expect(receivedPreviewToken("order","BILL")).toBe("expired-token");preparePreview("order","BILL",[paper],DEFAULT_PRINTER_SETTINGS,undefined,receivedPreviewToken("order","BILL"));vi.advanceTimersByTime(PAPER_PREVIEW_TTL_MS+1);expect(previewTokenFor("order","BILL")).toBe("expired-token");
 }finally{vi.useRealTimers();}
});
it("a rendering problem does not throw before the print action can queue its paper",()=>{
 setOperationalSession(session);
 expect(()=>preparePreview("order","ROUND",[paper],{...DEFAULT_PRINTER_SETTINGS,kitchen:{target:{kind:"system",name:"Printer"},width:48}},()=>{throw new Error("Bad menu tags");},"token")).not.toThrow();
 expect(previewTokenFor("order","ROUND")).toBe("token");
});
