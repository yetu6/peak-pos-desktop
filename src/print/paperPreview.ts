import type { POSPaper, POSPrintJob } from "../lib/posContracts";
import { paperFor } from "../lib/printJobs";
import { stationWords } from "../kitchen/kitchenWords";
import { readable } from "./escpos";
import type { PrinterSettings } from "./printerSettings";

/** One paper as the preview shows it: the tab's name, and the paper's lines -- or why it doesn't print here. */
export interface PaperView {
  key: string;
  name: string;
  /** Characters to a line on the paper (48 on 80 mm, 32 on 58 mm). */
  width: number;
  text: string | null;
  notHere: string | null;
}

/** The system's own printer, with no paper width of its own, shows at 80 mm's. */
const SYSTEM_WIDTH = 48;

/**
 * The papers Print order or Print bill would print, as this till prints
 * them: the same paper (paperFor) the printer gets, read back as its text,
 * at its width (owner, 2026-10-21: every paper is shown before it prints).
 */
export function paperViews(
  papers: readonly POSPaper[],
  settings: PrinterSettings,
  tagsOf?: (productId: string) => string | undefined,
): PaperView[] {
  return papers.map((paper, index) => {
    const job: POSPrintJob = {
      id: `preview-${index}`, sourceType: "POS_ORDER", sourceId: "", jobType: paper.jobType, document: paper.document,
      status: "ON_FILE", attempts: 0, createdAt: "",
    };
    const station = typeof paper.document.station === "string" ? paper.document.station : undefined;
    const name = paper.jobType === "BILL" ? "Bill" : station ? stationWords(station) : "Kitchen";
    let made: ReturnType<typeof paperFor>;
    try {
      made = paperFor(job, { settings, printRaw: async () => undefined, tagsOf });
    } catch {
      // A document this till can't make into paper: said, never a broken screen.
      return { key: `${index}`, name, width: SYSTEM_WIDTH, text: null, notHere: "This paper can't be shown. Print it, and check what comes out." };
    }
    if (made.kind === "none") {
      return {
        key: `${index}`, name, width: SYSTEM_WIDTH, text: null,
        notHere: made.why === "kitchen-off"
          ? "This till prints no kitchen papers: the kitchen reads the order on its screen."
          : `${name} has no printer on this till: it reads the order on its screen.`,
      };
    }
    if (made.kind === "thermal") return { key: `${index}`, name, width: made.width, text: readable(made.bytes), notHere: null };
    return { key: `${index}`, name, width: SYSTEM_WIDTH, text: made.text, notHere: null };
  });
}
