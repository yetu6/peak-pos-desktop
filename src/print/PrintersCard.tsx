import { Printer } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button, Field, SegmentedControl } from "../components/system";
import { stationWords } from "../kitchen/kitchenWords";
import type { PrepStation } from "../lib/posContracts";
import { PAPER_58MM, PAPER_80MM, type PaperWidth } from "./escpos";
import { kitchenTicketBytes } from "./kitchenTicket";
import {
  DEFAULT_PRINTER_SETTINGS, parseNetworkAddress, printerWords, type PrinterChoice, type PrinterSettings,
} from "./printerSettings";
import { listSystemPrinters, loadPrinterSettings, printRawToPrinter, savePrinterSettings } from "./printerStore";

const STATIONS: readonly PrepStation[] = ["GENERAL", "HOT", "COLD", "BAR", "GRILL", "PASTRY"];
const OWN = "own";
const SAME = "same";
const NETWORK = "network";

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

/**
 * Manager → Printers (S8a): paper kitchen tickets for a kitchen or bar
 * without a screen, to the kitchen's printer -- by name on this computer or
 * by address on the network -- with a printer of its own for any station.
 */
export function PrintersCard() {
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
      setWords({ ok: true, text: settings.kitchenTickets
        ? `Saved. Kitchen tickets print at ${printerWords(settings.kitchen)}.`
        : "Saved. This till won't print kitchen tickets." });
    } catch (error) {
      setWords({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function test(choice: PrinterChoice | null) {
    if (!choice) {
      setWords({ ok: false, text: "Choose the kitchen printer first, then print a test ticket." });
      return;
    }
    setBusy(true);
    setWords(null);
    try {
      await printRawToPrinter(choice.target, kitchenTicketBytes(TEST_TICKET, choice.width));
      setWords({ ok: true, text: `A test ticket went to ${printerWords(choice)}. If nothing came out, check the printer is on and has paper.` });
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
            onChange={(kitchen) => setSettings({ ...settings, kitchen })}
            testId="kitchen-printer"
          />
          <details className="y-printers__stations">
            <summary>A printer for one station (optional)</summary>
            {STATIONS.map((station) => (
              <PrinterPicker
                key={station}
                label={stationWords(station)}
                value={settings.stations[station] ?? null}
                printers={printers}
                onChange={(choice) => {
                  const stations = { ...settings.stations };
                  if (choice) stations[station] = choice;
                  else delete stations[station];
                  setSettings({ ...settings, stations });
                }}
                testId={`station-printer-${station}`}
              />
            ))}
          </details>
        </>
      ) : null}
      <div className="y-printers__actions">
        <Button variant="primary" size={56} disabled={busy} onClick={() => void save()} data-testid="save-printers">
          Save printers
        </Button>
        <Button variant="quiet" size={56} icon={<Printer />} disabled={busy || !settings.kitchenTickets} onClick={() => void test(settings.kitchen)} data-testid="test-kitchen-printer">
          Print a test ticket
        </Button>
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
  label, value, printers, allowOwn = false, onChange, testId,
}: {
  label: string;
  value: PrinterChoice | null;
  printers: readonly string[];
  /** The kitchen printer may be this till's own; a station's falls back to the kitchen's. */
  allowOwn?: boolean;
  onChange: (choice: PrinterChoice | null) => void;
  testId: string;
}) {
  const id = useId();
  const kindOf = (choice: PrinterChoice | null) =>
    !choice ? (allowOwn ? OWN : SAME) : choice.target.kind === "network" ? NETWORK : `system:${choice.target.name}`;
  // The picker's own choice: "a printer on the network" stays chosen while its address is being typed.
  const [kind, setKind] = useState(kindOf(value));
  useEffect(() => {
    if (value) setKind(kindOf(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const width: PaperWidth = value?.width ?? PAPER_80MM;
  const [address, setAddress] = useState(value?.target.kind === "network" ? `${value.target.host}:${value.target.port}` : "");
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
          else if (next === NETWORK) onChange(parsed ? { target: { kind: "network", ...parsed }, width } : null);
          else onChange({ target: { kind: "system", name: next.slice("system:".length) }, width });
        }}
      >
        {allowOwn ? <option value={OWN}>This till's own printer</option> : <option value={SAME}>The kitchen printer</option>}
        {printers.map((name) => <option key={name} value={`system:${name}`}>{name}</option>)}
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
            onChange(ok ? { target: { kind: "network", ...ok }, width } : null);
          }}
          error={address && !parsed ? "That isn't a printer's address. Write it as on its test page, such as 192.168.1.50." : undefined}
          autoComplete="off"
        />
      ) : null}
      {value ? (
        <SegmentedControl
          label={`${label}: paper`}
          options={[{ value: String(PAPER_58MM), label: "58 mm paper" }, { value: String(PAPER_80MM), label: "80 mm paper" }]}
          value={String(width)}
          onChange={(next) => onChange({ ...value, width: Number(next) === PAPER_58MM ? PAPER_58MM : PAPER_80MM })}
        />
      ) : null}
    </div>
  );
}
