import { PRINT_RECOVERY_WORDS } from "./printQueueWords";
import { type OperationalSession, getOperationalSession } from "../lib/operationalSession";
import type { TillPaper } from "../lib/printJobs";

export interface NativePrintEvidence {
 jobId:string;attempt:number;state:"reserved"|"accepted"|"unknown"|"not_sent";message?:string|null;
}
function scope(session: OperationalSession | null) {
 if(getOperationalSession() !== session) throw new Error(PRINT_RECOVERY_WORDS.sessionChanged);
 if(!session)throw new Error(PRINT_RECOVERY_WORDS.signIn);
 return {propertyId:session.propertyId,outletId:session.outletId,terminalId:session.terminalId};
}
export function usesNativePrintJournal(): boolean {
 return typeof window!=="undefined" && "__TAURI_INTERNALS__" in window;
}
export async function inspectNativePrint(jobId:string, session = getOperationalSession()): Promise<NativePrintEvidence|null> {
 const {invoke}=await import("@tauri-apps/api/core");
 return invoke("get_print_attempt",{scope:scope(session),jobId});
}
export async function nativePrintOnce(jobId:string,attempt:number,paper:Exclude<TillPaper,{kind:"none"}>,session = getOperationalSession()):Promise<NativePrintEvidence> {
 const {invoke}=await import("@tauri-apps/api/core");
 const document=paper.kind==="thermal"?{kind:"thermal",target:paper.target,bytes:Array.from(paper.bytes)}:{kind:"system",title:paper.title,text:paper.text};
 return invoke("print_job_once",{scope:scope(session),jobId,attempt,confirmedBackendClaim:true,paper:document});
}
