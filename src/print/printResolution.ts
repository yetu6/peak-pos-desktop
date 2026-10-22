import { PRINT_RECOVERY_WORDS, PRINT_RESOLUTION_WORDS } from "./printQueueWords";
import type { POSPrintJob } from "../lib/posContracts";
import { getOperationalSession } from "../lib/operationalSession";
import { ackFailed, ackPrinted } from "../lib/printJobs";
import { inspectNativePrint, resolveNativeNotPrinted } from "./nativePrintJournal";

/** An explicit operator observation, audited by the existing printed action. Never resends bytes. */
export async function confirmPaperPrinted(job: POSPrintJob): Promise<void> {
 const session = getOperationalSession();
 if(job.status!=="CLAIMED"||job.claimedByTerminalId!==getOperationalSession()?.terminalId)throw new Error(PRINT_RECOVERY_WORDS.differentTill);
 const evidence=await inspectNativePrint(job.id,session);
 if(getOperationalSession() !== session) throw new Error(PRINT_RECOVERY_WORDS.sessionChanged);
 if(evidence?.state!=="unknown")throw new Error(PRINT_RECOVERY_WORDS.checkFirst);
 await ackPrinted(job.id,job.attempts);
}

/**
 * Staff looked and no paper came out. This till's record of the attempt is corrected
 * first, then Yetu is told it failed, so Print again prints the job itself, not a copy.
 * In that order: if Yetu can't be reached, Check printing finishes it from the record.
 */
export async function confirmPaperNotPrinted(job: POSPrintJob): Promise<void> {
 const session = getOperationalSession();
 if(job.status!=="CLAIMED"||job.claimedByTerminalId!==getOperationalSession()?.terminalId)throw new Error(PRINT_RECOVERY_WORDS.differentTill);
 const evidence=await inspectNativePrint(job.id,session);
 if(getOperationalSession() !== session) throw new Error(PRINT_RECOVERY_WORDS.sessionChanged);
 if(evidence?.state!=="unknown"||evidence.attempt!==job.attempts)throw new Error(PRINT_RECOVERY_WORDS.checkFirst);
 await resolveNativeNotPrinted(job.id,evidence.attempt,session);
 await ackFailed(job.id,PRINT_RESOLUTION_WORDS.notPrintedReason,job.attempts);
}
