import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { inspectNativePrint, nativePrintOnce } from "./nativePrintJournal";
import { setOperationalSession, clearOperationalSession } from "../lib/operationalSession";
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke}));
const session={token:"",expiresAt:"",tenantId:"tenant",propertyId:"property",outletId:"outlet",terminalId:"mine",staffId:"staff",assurance:"RESTRICTED" as const};
beforeEach(()=>{vi.clearAllMocks();setOperationalSession(session);invoke.mockResolvedValue(null);});
afterEach(clearOperationalSession);
it("keeps the captured scope on the native probe",async()=>{await inspectNativePrint("paper",session);expect(invoke).toHaveBeenCalledWith("get_print_attempt",{scope:{propertyId:"property",outletId:"outlet",terminalId:"mine"},jobId:"paper"});});
it("changing session during module loading stops both probe and dispatch",async()=>{
 const probe=inspectNativePrint("paper",session);setOperationalSession({...session,propertyId:"other"});await expect(probe).rejects.toThrow("signed-in till changed");expect(invoke).not.toHaveBeenCalled();
 setOperationalSession(session);const send=nativePrintOnce("paper",1,{kind:"system",title:"Bill",text:"Bill"},session);clearOperationalSession();await expect(send).rejects.toThrow("signed-in till changed");expect(invoke).not.toHaveBeenCalled();
});
