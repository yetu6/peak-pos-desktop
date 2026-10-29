import { useState } from "react";
import { checkPrinter, usePrinterProblem } from "../print/printerWatch";
import { Banner, Button } from "./system";

/**
 * A printer that hasn't printed what it was sent, on every screen (owner,
 * 2026-10-29): what Windows says is wrong, what to do, and Check again.
 */
export function PrinterProblemBanner() {
  const problem = usePrinterProblem();
  const [checking, setChecking] = useState(false);
  if (!problem) return null;
  return (
    <Banner
      tone="danger"
      data-testid="printer-problem"
      action={
        <Button
          variant="secondary"
          size={48}
          data-testid="printer-check-again"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void checkPrinter(problem.printer).finally(() => setChecking(false));
          }}
        >
          {checking ? "Checking…" : "Check again"}
        </Button>
      }
    >
      The printer {problem.printer} hasn't printed: {problem.words}. Check the paper, the lid and the power. What's waiting prints
      once it's fixed.
    </Banner>
  );
}
