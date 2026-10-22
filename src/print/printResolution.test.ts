import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { confirmPaperPrinted } from "./printResolution";
import { setOperationalSession, clearOperationalSession } from "../lib/operationalSession";
import type { POSPrintJob } from "../lib/posContracts";
const {inspect,ack}=vi.hoisted(()=>({inspect:vi.fn(),ack:vi.fn()}));
vi.mock("./nativePrintJournal",()=>({inspectNativePrint:inspect}));
vi.mock("../lib/printJobs",()=>({ackPrinted:ack}));
const job:POSPrintJob={id:"paper",sourceType:"POS_ORDER",sourceId:"order",jobType:"KITCHEN_TICKET",document:{},status:"CLAIMED",attempts:2,claimedByTerminalId:"mine",createdAt:""};
beforeEach(()=>{vi.clearAllMocks();inspect.mockResolvedValue({state:"unknown"});ack.mockResolvedValue(undefined);setOperationalSession({token:"",expiresAt:"",tenantId:"tenant",propertyId:"property",outletId:"outlet",terminalId:"mine",staffId:"staff",assurance:"RESTRICTED"});});
afterEach(clearOperationalSession);
it("an explicit observation only acknowledges the existing claim",async()=>{
 await confirmPaperPrinted(job);expect(ack).toHaveBeenCalledWith("paper",2);expect(ack).toHaveBeenCalledTimes(1);
});
it.each(["FAILED","PENDING","PRINTED","ON_FILE"] as const)("refuses resolving %s as an uncertain claim",async status=>{
 await expect(confirmPaperPrinted({...job,status})).rejects.toThrow("till that started");expect(ack).not.toHaveBeenCalled();
});
it("another terminal cannot resolve the paper",async()=>{await expect(confirmPaperPrinted({...job,claimedByTerminalId:"other"})).rejects.toThrow();expect(inspect).not.toHaveBeenCalled();expect(ack).not.toHaveBeenCalled();});
it.each([null,{state:"accepted"},{state:"not_sent"}])("only an uncertain native attempt can be manually confirmed: %j",async evidence=>{inspect.mockResolvedValue(evidence);await expect(confirmPaperPrinted(job)).rejects.toThrow("Check printing");expect(ack).not.toHaveBeenCalled();});
