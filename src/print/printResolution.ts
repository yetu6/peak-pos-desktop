import { PRINT_RECOVERY_WORDS } from "./printQueueWords";
import type { POSPrintJob } from "../lib/posContracts";
import { getOperationalSession } from "../lib/operationalSession";
import { ackPrinted } from "../lib/printJobs";
import { inspectNativePrint } from "./nativePrintJournal";

/** An explicit operator observation, audited by the existing printed action. Never resends bytes. */
export async function confirmPaperPrinted(job: POSPrintJob): Promise<void> {
 const session = getOperationalSession();
 if(job.status!=="CLAIMED"||job.claimedByTerminalId!==getOperationalSession()?.terminalId)throw new Error(PRINT_RECOVERY_WORDS.differentTill);
 const evidence=await inspectNativePrint(job.id,session);
 if(getOperationalSession() !== session) throw new Error(PRINT_RECOVERY_WORDS.sessionChanged);
 if(evidence?.state!=="unknown")throw new Error(PRINT_RECOVERY_WORDS.checkFirst);
 await ackPrinted(job.id,job.attempts);
}
