import { Printer, Send } from "lucide-react";
import { useState } from "react";
import { Banner, Button, Sheet, Tabs } from "../components/system";
import { usePaperPreview, usePrinterSettings } from "../hooks/usePosData";
import { preparePreview, receivedPreviewToken } from "../print/preparedPreview";
import { paperViews } from "../print/paperPreview";
import { DIRECT_HAND_OVER_WORDS } from "./registerWords";
import { stationPrintWords, stationSendWords } from "./rounds";

/**
 * Every paper, shown before it prints (owner, 2026-10-21): what Print order
 * or Print bill would print now, exactly as this till prints it -- each
 * station's paper on its own tab, at the paper's width. Print prints it;
 * Back prints nothing and sends nothing. With several stations' new items,
 * the paper shown also prints on its own -- "Print for bar" (owner,
 * 2026-10-22) -- and the others wait, still new.
 */
export function PaperPreviewSheet({
  orderId,
  kind,
  busy,
  nothingNew = false,
  directOnly = false,
  refusalOf,
  tagsOf,
  allOnly = false,
  onPrint,
  onBack,
}: {
  orderId: string;
  kind: "ROUND" | "AGAIN" | "BILL";
  busy: boolean;
  /** Print order with nothing new: it can only print the last papers again. */
  nothingNew?: boolean;
  /** All new lines are explicitly handed over at this till. */
  directOnly?: boolean;
  /** Yetu's refusal of these papers in the till's words, or null when it was the connection. */
  refusalOf?: (error: unknown) => string | null;
  tagsOf?: (productId: string) => string | undefined;
  /** Every paper prints together (before payment: the guest pays for what the kitchen has heard of). */
  allOnly?: boolean;
  /** Prints every paper, or only those stations' (Print for bar). */
  onPrint: (stations?: string[]) => void;
  onBack: () => void;
}) {
  const papers = usePaperPreview(orderId, kind);
  const settings = usePrinterSettings();
  const views = papers.data && settings.data ? paperViews(papers.data, settings.data, tagsOf) : null;
  const [tab, setTab] = useState("0");
  const shown = views?.[Number(tab)] ?? views?.[0] ?? null;
  // Nothing prints on this till (a kitchen that reads its screen): the order still goes to it --
  // unless nothing is new, when there is nothing to send and nothing to print.
  const screenOnly = views !== null && views.length > 0 && views.every((view) => !view.printsHere);
  const nothingToDo = screenOnly && (kind === "AGAIN" || (kind === "ROUND" && nothingNew));
  // Yetu refused these papers (a tab waiting for the next shift, a paid order): printing would be refused too.
  const refused = papers.isError ? refusalOf?.(papers.error) ?? null : null;
  const loading = papers.isLoading || settings.isLoading;
  const title = kind === "BILL" ? "Print bill" : kind === "AGAIN" ? "Print the kitchen ticket again" : "Print order";
  const sendDirect = directOnly && kind === "ROUND" && !nothingNew && views?.length === 0 && !papers.isError && !settings.isError;
  const blocked = busy || loading || refused !== null || nothingToDo || (views?.length === 0 && !sendDirect);
  // New items for more than one station: each paper prints on its own (not before payment), or all together.
  const stationPapers = kind === "ROUND" && !nothingNew && views !== null && views.length > 1 ? views.length : 0;
  const oneStation = stationPapers > 0 && !allOnly && shown?.station ? shown.station : null;

  function confirm(stations?: string[]) {
    if (papers.data && settings.data) preparePreview(orderId, kind, papers.data, settings.data, tagsOf, receivedPreviewToken(orderId, kind));
    if (stations) onPrint(stations);
    else onPrint();
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onBack();
      }}
      title={title}
      description={
        kind === "BILL"
          ? "The bill as it will print."
          : kind === "AGAIN"
            ? "The last papers again, marked COPY."
            : "The order as the kitchen and the bar will get it."
      }
      testId="paper-preview"
      footer={
        <div className="y-paper-preview__footer">
          <Button variant="quiet" disabled={busy} onClick={onBack}>
            Back
          </Button>
          {oneStation && shown ? (
            <Button size={64} disabled={blocked} onClick={() => confirm([oneStation])} data-testid="paper-print-one">
              {shown.printsHere ? stationPrintWords(oneStation) : stationSendWords(oneStation)}
            </Button>
          ) : null}
          <Button
            variant="primary"
            size={64}
            icon={sendDirect ? <Send /> : <Printer />}
            disabled={blocked}
            onClick={() => confirm()}
            data-testid="paper-print"
          >
            {busy
              ? "Printing…"
              : sendDirect
                ? "Send order"
              : nothingToDo
                ? "Nothing new to send"
                : screenOnly
                  ? "Send"
                  : stationPapers === 2
                    ? "Print both"
                    : stationPapers > 2
                      ? "Print all"
                      : "Print"}
          </Button>
        </div>
      }
    >
      {loading ? (
        <p className="y-paper-preview__status" role="status">
          Getting the papers ready…
        </p>
      ) : refused ? (
        <Banner inline tone="danger" data-testid="paper-preview-problem">
          {refused}
        </Banner>
      ) : papers.isError || settings.isError ? (
        <Banner inline tone="warning" data-testid="paper-preview-problem">
          The papers can't be shown just now. You can still print.
        </Banner>
      ) : views && views.length === 0 ? (
        <p className="y-paper-preview__status">{sendDirect ? DIRECT_HAND_OVER_WORDS : "Nothing to print yet."}</p>
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
