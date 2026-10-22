import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { confirmPaperNotPrinted, confirmPaperPrinted } from "./printResolution";
import { PRINT_RESOLUTION_WORDS } from "./printQueueWords";
import { setOperationalSession, clearOperationalSession } from "../lib/operationalSession";
import type { POSPrintJob } from "../lib/posContracts";
const {inspect,ack,resolve,failed}=vi.hoisted(()=>({inspect:vi.fn(),ack:vi.fn(),resolve:vi.fn(),failed:vi.fn()}));
vi.mock("./nativePrintJournal",()=>({inspectNativePrint:inspect,resolveNativeNotPrinted:resolve}));
vi.mock("../lib/printJobs",()=>({ackPrinted:ack,ackFailed:failed}));
const job:POSPrintJob={id:"paper",sourceType:"POS_ORDER",sourceId:"order",jobType:"KITCHEN_TICKET",document:{},status:"CLAIMED",attempts:2,claimedByTerminalId:"mine",createdAt:""};
beforeEach(()=>{vi.clearAllMocks();inspect.mockResolvedValue({state:"unknown",attempt:2});ack.mockResolvedValue(undefined);resolve.mockResolvedValue({state:"not_sent",attempt:2});failed.mockResolvedValue(undefined);setOperationalSession({token:"",expiresAt:"",tenantId:"tenant",propertyId:"property",outletId:"outlet",terminalId:"mine",staffId:"staff",assurance:"RESTRICTED"});});
afterEach(clearOperationalSession);
it("an explicit observation only acknowledges the existing claim",async()=>{
 await confirmPaperPrinted(job);expect(ack).toHaveBeenCalledWith("paper",2);expect(ack).toHaveBeenCalledTimes(1);
});
it.each(["FAILED","PENDING","PRINTED","ON_FILE"] as const)("refuses resolving %s as an uncertain claim",async status=>{
 await expect(confirmPaperPrinted({...job,status})).rejects.toThrow("till that started");expect(ack).not.toHaveBeenCalled();
});
it("another terminal cannot resolve the paper",async()=>{await expect(confirmPaperPrinted({...job,claimedByTerminalId:"other"})).rejects.toThrow();expect(inspect).not.toHaveBeenCalled();expect(ack).not.toHaveBeenCalled();});
it.each([null,{state:"accepted"},{state:"not_sent"}])("only an uncertain native attempt can be manually confirmed: %j",async evidence=>{inspect.mockResolvedValue(evidence);await expect(confirmPaperPrinted(job)).rejects.toThrow("Check printing");expect(ack).not.toHaveBeenCalled();});

it("staff who find no paper correct this till's record first, then tell Yetu it failed, for the same attempt",async()=>{
 await confirmPaperNotPrinted(job);
 expect(resolve).toHaveBeenCalledWith("paper",2,expect.objectContaining({terminalId:"mine"}));
 expect(failed).toHaveBeenCalledWith("paper",PRINT_RESOLUTION_WORDS.notPrintedReason,2);
 expect(resolve.mock.invocationCallOrder[0]).toBeLessThan(failed.mock.invocationCallOrder[0]);
 expect(ack).not.toHaveBeenCalled();
});
it("if this till's record can't be corrected, Yetu is not told the paper failed",async()=>{
 resolve.mockRejectedValue(new Error("Print journal refused the request"));
 await expect(confirmPaperNotPrinted(job)).rejects.toThrow();
 expect(failed).not.toHaveBeenCalled();
});
it.each([null,{state:"accepted",attempt:2},{state:"not_sent",attempt:2},{state:"unknown",attempt:1}])("only this attempt's uncertain paper can be called not printed: %j",async evidence=>{
 inspect.mockResolvedValue(evidence);
 await expect(confirmPaperNotPrinted(job)).rejects.toThrow("Check printing");
 expect(resolve).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();
});
it("another till cannot call the paper not printed",async()=>{
 await expect(confirmPaperNotPrinted({...job,claimedByTerminalId:"other"})).rejects.toThrow();
 expect(resolve).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();
});
