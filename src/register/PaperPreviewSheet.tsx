import { Printer } from "lucide-react";
import { useState } from "react";
import { Banner, Button, Sheet, Tabs } from "../components/system";
import { usePaperPreview, usePrinterSettings } from "../hooks/usePosData";
import { paperViews } from "../print/paperPreview";

/**
 * Every paper, shown before it prints (owner, 2026-10-21): what Print order
 * or Print bill would print now, exactly as this till prints it -- each
 * station's paper on its own tab, at the paper's width. Print prints it;
 * Back prints nothing and sends nothing.
 */
export function PaperPreviewSheet({
  orderId,
  kind,
  busy,
  tagsOf,
  onPrint,
  onBack,
}: {
  orderId: string;
  kind: "ROUND" | "BILL";
  busy: boolean;
  tagsOf?: (productId: string) => string | undefined;
  onPrint: () => void;
  onBack: () => void;
}) {
  const papers = usePaperPreview(orderId, kind);
  const settings = usePrinterSettings();
  const views = papers.data && settings.data ? paperViews(papers.data, settings.data, tagsOf) : null;
  const [tab, setTab] = useState("0");
  const shown = views?.[Number(tab)] ?? views?.[0] ?? null;
  // Nothing prints on this till (a kitchen that reads its screen): the order still goes to it.
  const screenOnly = views !== null && views.length > 0 && views.every((view) => view.text === null);
  const title = kind === "BILL" ? "Print bill" : "Print order";

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onBack();
      }}
      title={title}
      description={kind === "BILL" ? "The bill as it will print." : "The order as the kitchen and the bar will get it."}
      testId="paper-preview"
      footer={
        <div className="y-paper-preview__footer">
          <Button variant="quiet" disabled={busy} onClick={onBack}>
            Back
          </Button>
          <Button variant="primary" size={64} icon={<Printer />} disabled={busy || views?.length === 0} onClick={onPrint} data-testid="paper-print">
            {busy ? "Printing…" : screenOnly ? "Send" : "Print"}
          </Button>
        </div>
      }
    >
      {papers.isLoading || settings.isLoading ? (
        <p className="y-paper-preview__status" role="status">
          Getting the papers ready…
        </p>
      ) : papers.isError || settings.isError ? (
        <Banner inline tone="warning" data-testid="paper-preview-problem">
          The papers can't be shown just now. You can still print.
        </Banner>
      ) : views && views.length === 0 ? (
        <p className="y-paper-preview__status">Nothing to print yet.</p>
      ) : views ? (
        <>
          {views.length > 1 ? (
            <Tabs
              label="Papers"
              tabs={views.map((view, index) => ({ value: String(index), label: view.name }))}
              value={String(views.indexOf(shown!))}
              onChange={setTab}
            />
          ) : null}
          {shown?.notHere ? (
            <p className="y-paper-preview__status" data-testid="paper-not-here">
              {shown.notHere}
            </p>
          ) : shown ? (
            <pre
              className="y-paper"
              style={{ ["--paper-chars" as string]: shown.width }}
              aria-label={`${shown.name} paper`}
              data-testid="paper-text"
            >
              {shown.text}
            </pre>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}
