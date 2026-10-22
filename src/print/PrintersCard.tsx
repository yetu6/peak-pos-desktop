import { Printer } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button, Field, SegmentedControl } from "../components/system";
import { PREP_STATIONS, stationWords } from "../kitchen/kitchenWords";
import { PAPER_58MM, PAPER_80MM, type PaperWidth } from "./escpos";
import { kitchenTicketBytes } from "./kitchenTicket";
import { loadBillLogo } from "./billLogo";
import { receiptBytes } from "./receipt";
import {
  DEFAULT_PRINTER_SETTINGS, MAX_STATION_COPIES, stationCopies, NO_PAPER, parseNetworkAddress, printerWords, type PrinterChoice, type PrinterSettings,
} from "./printerSettings";
import { listSystemPrinters, loadPrinterSettings, printRawToPrinter, savePrinterSettings } from "./printerStore";

const OWN = "own";
const SAME = "same";
const NETWORK = "network";
const NO_PAPER_KIND = "nopaper";

/** A sample ticket for "Print a test ticket": the kitchen's layout, nothing sold. */
const TEST_TICKET = {
  dailyNumber: 0,
  station: "GENERAL",
  serviceType: "DINE_IN" as const,
  label: "Test",
  waiterName: "Test print",
  sentAt: new Date().toISOString(),
  lines: [{ quantity: 1, name: "Test ticket: this printer works", options: ["Nothing to make"] }],
};

/** A sample bill for "Print a test bill": the layout, no amounts, nothing sold, nothing paid. */
const TEST_RECEIPT = {
  propertyName: "Test bill",
  beforePayment: true,
  lines: [{ name: "Test: this printer works", quantity: "1" }],
};

/** A printer inside a sentence: "this till's own printer" in lower case. */
function printerPlace(choice: PrinterChoice | null): string {
  return choice ? printerWords(choice) : "this till's own printer";
}

/** What the saved settings do, in words. */
function savedWords(settings: PrinterSettings): string {
  const kitchen = settings.kitchenTickets
    ? `Kitchen tickets print at ${printerPlace(settings.kitchen)}.`
    : "This till won't print kitchen tickets.";
  const receipts = `Bills print at ${printerPlace(settings.receipt)}${settings.cashDrawer ? ", and its cash drawer opens for cash" : ""}.`;
  return `Saved. ${kitchen} ${receipts}`;
}

/**
 * Status → Printers (S8a): paper kitchen tickets for a kitchen or bar
 * without a screen, to the kitchen's printer -- by name on this computer or
 * by address on the network -- with a printer of its own for any station.
 */
export function PrintersCard({ billLogoUrl }: { billLogoUrl?: string } = {}) {
  const headingId = useId();
  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS);
  const [printers, setPrinters] = useState<string[]>([]);
  const [words, setWords] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadPrinterSettings().then(setSettings);
    void listSystemPrinters().then(setPrinters);
  }, []);

  async function save() {
    setBusy(true);
    setWords(null);
    try {
      await savePrinterSettings(settings);
      setWords({ ok: true, text: savedWords(settings) });
    } catch (error) {
      setWords({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function test(choice: PrinterChoice | null, what: "kitchen" | "receipt" = "kitchen") {
    if (!choice) {
      setWords({ ok: false, text: "Choose the kitchen printer first, then print a test ticket." });
      return;
    }
    setBusy(true);
    setWords(null);
    try {
      await printRawToPrinter(
        choice.target,
        what === "receipt"
          ? receiptBytes(TEST_RECEIPT, choice.width, { drawer: settings.cashDrawer, logo: await loadBillLogo(billLogoUrl, choice.width, choice.billLogo) })
          : kitchenTicketBytes(TEST_TICKET, choice.width, settings),
      );
      const sample = what === "receipt" ? "A test bill" : "A test ticket";
      setWords({ ok: true, text: `${sample} went to ${printerWords(choice)}. If nothing came out, check the printer is on and has paper.` });
    } catch (error) {
      setWords({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="y-cash__card" aria-labelledby={headingId} data-testid="printers-card">
      <h2 id={headingId} className="y-cash__card-title">
        Printers
      </h2>
      <label className="y-printers__switch">
        <input
          type="checkbox"
          role="switch"
          checked={settings.kitchenTickets}
          onChange={(event) => setSettings({ ...settings, kitchenTickets: event.target.checked })}
          data-testid="kitchen-tickets-on"
        />
        <span>Print kitchen tickets on paper</span>
      </label>
      <p className="y-cash__muted">
        For a kitchen or bar without a screen: each order, and each round, prints with its number, the table and who took it.
      </p>
      {settings.kitchenTickets ? (
        <>
          <PrinterPicker
            label="Kitchen printer"
            value={settings.kitchen}
            printers={printers}
            allowOwn
            onChange={(kitchen) => setSettings({ ...settings, kitchen: kitchen === NO_PAPER ? null : kitchen })}
            testId="kitchen-printer"
          />
          <label className="y-printers__switch">
            <input type="checkbox" role="switch" checked={settings.quantityBold ?? true} onChange={event => setSettings({ ...settings, quantityBold: event.target.checked })} />
            <span>Bold quantities</span>
          </label>
          <label className="y-printers__switch">
            <input type="checkbox" role="switch" checked={settings.quantityLarge ?? true} onChange={event => setSettings({ ...settings, quantityLarge: event.target.checked })} />
            <span>Large quantities</span>
          </label>
          <details className="y-printers__stations">
            <summary>A printer for one station (optional)</summary>
            {PREP_STATIONS.map((station) => (
              <div key={station}>
              <PrinterPicker
                label={stationWords(station)}
                value={settings.stations[station] ?? null}
                printers={printers}
                allowNoPaper
                onChange={(choice) => {
                  const stations = { ...settings.stations };
                  if (choice) stations[station] = choice;
                  else delete stations[station];
                  setSettings({ ...settings, stations });
                }}
                testId={`station-printer-${station}`}
              />
              {settings.stations[station] !== NO_PAPER ? (
                <label className="y-printers__label">
                  {stationWords(station)}: copies
                  <select className="y-printers__select" aria-label={`${stationWords(station)}: copies`} value={stationCopies(settings, station)}
                    onChange={event => setSettings({ ...settings, stationCopies: { ...settings.stationCopies, [station]: Number(event.target.value) } })}>
                    {Array.from({ length: MAX_STATION_COPIES }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count}</option>)}
                  </select>
                </label>
              ) : null}
              </div>
            ))}
          </details>
        </>
      ) : null}
      <h3 className="y-printers__subtitle">Bills</h3>
      <PrinterPicker
        label="Bill printer"
        value={settings.receipt}
        printers={printers}
        allowOwn
        onChange={(choice) => {
          const receipt = choice === NO_PAPER ? null : choice;
          setSettings({ ...settings, receipt, cashDrawer: receipt ? settings.cashDrawer : false });
        }}
        testId="receipt-printer"
      />
      {settings.receipt ? (
        <>
        <label className="y-printers__switch">
          <input type="checkbox" role="switch" checked={settings.receipt.billLogo ?? false}
            onChange={event => setSettings({ ...settings, receipt: settings.receipt ? { ...settings.receipt, billLogo: event.target.checked } : null })} />
          <span>Print the business logo on bills</span>
        </label>
        {settings.receipt.billLogo ? (
          <>
            <p className="y-cash__muted">The logo comes from the property branding in the hotel app.</p>
            <p className="y-cash__muted">Use a simple logo. Photos and gradients may print poorly. If the image cannot print, the business name still prints. Switch the logo off if the printer does not support images.</p>
          </>
        ) : null}
        <label className="y-printers__switch">
          <input
            type="checkbox"
          role="switch"
            checked={settings.cashDrawer}
            onChange={(event) => setSettings({ ...settings, cashDrawer: event.target.checked })}
            data-testid="cash-drawer-on"
          />
          <span>A cash drawer is plugged into this printer: open it for cash</span>
        </label>
        </>
      ) : null}
      <div className="y-printers__actions">
        <Button variant="primary" size={56} disabled={busy} onClick={() => void save()} data-testid="save-printers">
          Save printers
        </Button>
        <Button variant="quiet" size={56} icon={<Printer />} disabled={busy || !settings.kitchenTickets} onClick={() => void test(settings.kitchen)} data-testid="test-kitchen-printer">
          Print a test ticket
        </Button>
        {settings.receipt ? (
          <Button variant="quiet" size={56} icon={<Printer />} disabled={busy} onClick={() => void test(settings.receipt, "receipt")} data-testid="test-receipt-printer">
            Print a test bill
          </Button>
        ) : null}
      </div>
      {words ? (
        <p role={words.ok ? "status" : "alert"} className={words.ok ? "y-cash__muted" : "y-printers__error"} data-testid="printers-words">
          {words.text}
        </p>
      ) : null}
    </section>
  );
}

function PrinterPicker({
  label, value, printers, allowOwn = false, allowNoPaper = false, onChange, testId,
}: {
  label: string;
  value: PrinterChoice | null | typeof NO_PAPER;
  printers: readonly string[];
  /** The kitchen printer may be this till's own; a station's falls back to the kitchen's. */
  allowOwn?: boolean;
  /** A station may print no ticket on this till. */
  allowNoPaper?: boolean;
  onChange: (choice: PrinterChoice | null | typeof NO_PAPER) => void;
  testId: string;
}) {
  const id = useId();
  const kindOf = (choice: PrinterChoice | null | typeof NO_PAPER) =>
    choice === NO_PAPER ? NO_PAPER_KIND : !choice ? (allowOwn ? OWN : SAME) : choice.target.kind === "network" ? NETWORK : `system:${choice.target.name}`;
  // The picker's own choice: "a printer on the network" stays chosen while its address is being typed.
  const [kind, setKind] = useState(kindOf(value));
  useEffect(() => {
    if (value) setKind(kindOf(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  // "No paper" is no printer to set: no width, no address.
  const choice = value === NO_PAPER ? null : value;
  const width: PaperWidth = choice?.width ?? PAPER_80MM;
  const [address, setAddress] = useState(choice?.target.kind === "network" ? `${choice.target.host}:${choice.target.port}` : "");
  const parsed = parseNetworkAddress(address);
  return (
    <div className="y-printers__picker" data-testid={testId}>
      <label htmlFor={id} className="y-printers__label">{label}</label>
      <select
        id={id}
        className="y-printers__select"
        value={kind}
        onChange={(event) => {
          const next = event.target.value;
          setKind(next);
          if (next === OWN || next === SAME) onChange(null);
          else if (next === NO_PAPER_KIND) onChange(NO_PAPER);
          else if (next === NETWORK) onChange(parsed ? { ...choice, target: { kind: "network", ...parsed }, width } : null);
          else onChange({ ...choice, target: { kind: "system", name: next.slice("system:".length) }, width });
        }}
      >
        {allowOwn ? <option value={OWN}>This till's own printer</option> : <option value={SAME}>The kitchen printer</option>}
        {printers.map((name) => <option key={name} value={`system:${name}`}>{name}</option>)}
        {allowNoPaper ? <option value={NO_PAPER_KIND}>No paper for this station</option> : null}
        <option value={NETWORK}>A printer on the network…</option>
      </select>
      {kind === NETWORK ? (
        <Field
          label="Its address"
          hint="As on the printer's own test page, such as 192.168.1.50."
          value={address}
          onChange={(next) => {
            setAddress(next);
            const ok = parseNetworkAddress(next);
            onChange(ok ? { ...choice, target: { kind: "network", ...ok }, width } : null);
          }}
          error={address && !parsed ? "That isn't a printer in this building. Write its address as on its test page, such as 192.168.1.50." : undefined}
          autoComplete="off"
        />
      ) : null}
      {choice ? (
        <SegmentedControl
          label={`${label}: paper`}
          options={[{ value: String(PAPER_58MM), label: "58 mm paper" }, { value: String(PAPER_80MM), label: "80 mm paper" }]}
          value={String(width)}
          onChange={(next) => onChange({ ...choice, width: Number(next) === PAPER_58MM ? PAPER_58MM : PAPER_80MM })}
        />
      ) : null}
    </div>
  );
}
