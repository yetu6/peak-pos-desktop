import { Banknote, ChefHat, NotebookPen, ReceiptText } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Banner,
  Button,
  EmptyState,
  Field,
  IconButton,
  KeyHint,
  Keypad,
  ListRow,
  Money,
  MoneyField,
  PermissionNotice,
  QuickCash,
  SearchField,
  SegmentedControl,
  Skeleton,
  StatusChip,
  Stepper,
  SupervisorApproval,
  Tabs,
  TicketLine,
  Tile,
  Toast,
} from "../components/system";
import { formatMoney } from "../lib/money";
import type { OrderStatus, ServiceType } from "../lib/posContracts";
import { orderStatusTone, orderStatusWords, paymentMethodWords, serviceTypeWords } from "../lib/words";
import "./gallery.css";

/**
 * Development-only gallery of every design-system component, for the pixel
 * harness and for people judging the system in Light and Dark at every size.
 * Data is shaped like the backend's (posContracts.ts); the currency is the one
 * a Tanzanian outlet's catalog returns.
 */

const CURRENCY = "TZS";
const STATUSES: OrderStatus[] = ["OPEN", "SENT", "PREPARING", "READY", "SERVED", "CLOSED", "VOIDED"];
const SERVICE_TYPES: ServiceType[] = ["DINE_IN", "TAKEAWAY", "ROOM_SERVICE"];

const MENU: Array<{ name: string; priceMinor: number; mark: 1 | 2 | 3 | 4; soldOut?: boolean }> = [
  { name: "Cappuccino", priceMinor: 650_000, mark: 1 },
  { name: "Grilled chicken with chips and kachumbari", priceMinor: 2_500_000, mark: 2 },
  { name: "Chocolate tart", priceMinor: 950_000, mark: 3 },
  { name: "Fresh passion juice", priceMinor: 600_000, mark: 4, soldOut: true },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="y-gallery__section" aria-labelledby={id}>
      <h2 id={id} className="y-gallery__section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SystemGalleryFixture() {
  const [service, setService] = useState<ServiceType>("DINE_IN");
  const [tab, setTab] = useState<"open" | "paid">("open");
  const [quantity, setQuantity] = useState(2);
  const [search, setSearch] = useState("tart");
  const [table, setTable] = useState("12");
  const [cash, setCash] = useState("50000");
  const [selectedLine, setSelectedLine] = useState("cappuccino");

  return (
    <div className="y-gallery" data-testid="system-gallery">
      <header className="y-gallery__header">
        <h1 className="y-gallery__title">Yetu till components</h1>
        <p className="y-gallery__lede">Every part a till screen is built from, in this theme.</p>
      </header>

      <div className="y-gallery__grid">
        <Section id="gallery-actions" title="Actions">
          <div className="y-gallery__stack">
            <Button variant="primary" size={64} keyHint="F9" block>
              Pay {formatMoney(4_250_000, CURRENCY)}
            </Button>
            <div className="y-gallery__row">
              <Button variant="secondary" size={56} icon={<ChefHat />}>
                Send to kitchen
              </Button>
              <Button variant="quiet">More actions</Button>
            </div>
            <div className="y-gallery__row">
              <Button variant="danger">Void order</Button>
              <Button variant="secondary" disabled>
                Nothing to send
              </Button>
              <IconButton label="Add a note" icon={<NotebookPen />} variant="secondary" />
            </div>
          </div>
        </Section>

        <Section id="gallery-choices" title="Choices">
          <div className="y-gallery__stack">
            <SegmentedControl
              label="Order type"
              value={service}
              onChange={setService}
              options={SERVICE_TYPES.map((type) => ({ value: type, label: serviceTypeWords(type) }))}
            />
            <Tabs
              label="Order lists"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: "open", label: "Open", count: 4 },
                { value: "paid", label: "Paid today", count: 12 },
              ]}
            />
            <Stepper label="Cappuccino" value={quantity} min={1} max={20} onChange={setQuantity} />
          </div>
        </Section>

        <Section id="gallery-fields" title="Fields">
          <div className="y-gallery__stack">
            <SearchField label="Search the menu" value={search} onChange={setSearch} placeholder="Search the menu" />
            <Field label="Table" hint="As written on the table" value={table} onChange={setTable} />
            <Field label="Reason" value="" onChange={() => undefined} error="Say why the cash is going out." />
            <MoneyField label="Cash received" currency={CURRENCY} value={cash} onValueChange={(text) => setCash(text)} />
          </div>
        </Section>

        <Section id="gallery-cash" title="Keypad and quick cash">
          <div className="y-gallery__stack">
            <QuickCash dueMinor={4_250_000} currency={CURRENCY} onPick={(minor) => setCash(String(minor / 100))} />
            <Keypad label="Amount" onKey={() => undefined} />
          </div>
        </Section>

        <Section id="gallery-status" title="Status in words">
          <div className="y-gallery__chips">
            {STATUSES.map((status) => (
              <StatusChip key={status} tone={orderStatusTone(status)}>
                {orderStatusWords(status)}
              </StatusChip>
            ))}
            <StatusChip tone="accent">New</StatusChip>
            <StatusChip tone="warning">Getting late · 12 min</StatusChip>
          </div>
        </Section>

        <Section id="gallery-money" title="Money">
          <div className="y-gallery__stack">
            <Money minor={4_250_000} currency={CURRENCY} size="body" />
            <Money minor={4_250_000} currency={CURRENCY} size="title" />
            <Money minor={4_250_000} currency={CURRENCY} size="figure" />
            <p className="y-gallery__caption">Change to give</p>
            <Money minor={750_000} currency={CURRENCY} size="display" />
          </div>
        </Section>

        <Section id="gallery-tiles" title="Menu tiles">
          <div className="y-gallery__tiles">
            {MENU.map((item) => (
              <Tile
                key={item.name}
                name={item.name}
                price={formatMoney(item.priceMinor, CURRENCY)}
                mark={item.mark}
                soldOut={item.soldOut}
                onClick={() => undefined}
              />
            ))}
          </div>
        </Section>

        <Section id="gallery-ticket" title="Ticket lines">
          <div className="y-gallery__panel">
            <TicketLine
              quantity={2}
              name="Cappuccino"
              options={["Oat milk"]}
              amount={formatMoney(1_500_000, CURRENCY)}
              selected={selectedLine === "cappuccino"}
              onSelect={() => setSelectedLine("cappuccino")}
            />
            <TicketLine
              quantity={1}
              name="Grilled chicken with chips"
              options={["Well done", "Extra kachumbari"]}
              note="No onions"
              amount={formatMoney(2_500_000, CURRENCY)}
              sent
              selected={selectedLine === "chicken"}
              onSelect={() => setSelectedLine("chicken")}
            />
          </div>
        </Section>

        <Section id="gallery-rows" title="List rows">
          <div className="y-gallery__panel">
            <ListRow
              title="Order 0142 · Table 12"
              meta="Amina Hassan · 14:05"
              leading={<ReceiptText aria-hidden="true" />}
              trailing={<Money minor={4_250_000} currency={CURRENCY} />}
              onClick={() => undefined}
            />
            <ListRow
              title={paymentMethodWords("MOBILE_MONEY")}
              meta="Paid 14:20"
              leading={<Banknote aria-hidden="true" />}
              trailing={<StatusChip tone="success">Paid</StatusChip>}
            />
          </div>
        </Section>

        <Section id="gallery-notices" title="Notices">
          <div className="y-gallery__stack">
            <Banner tone="info">An update is ready. It installs when the shift is closed.</Banner>
            <Banner tone="warning">Working offline. Cash only.</Banner>
            <Banner tone="danger">This till can't store its key safely. Call support before taking payments.</Banner>
            <Banner tone="success" action={<Button variant="quiet">Print again</Button>}>
              Paid {formatMoney(4_250_000, CURRENCY)}
            </Banner>
            <Toast tone="success">Sent to kitchen 14:05</Toast>
            <PermissionNotice action="void orders" who="a supervisor" next="Ask one to help." />
            <p className="y-gallery__keys">
              Keys: <KeyHint keys="F1" /> Sell <KeyHint keys="Ctrl+K" /> Search <KeyHint keys="Ctrl+L" /> Lock
            </p>
          </div>
        </Section>

        <Section id="gallery-empty" title="Empty and loading">
          <div className="y-gallery__stack">
            <EmptyState
              icon={<ReceiptText />}
              title="No orders open"
              description="New orders appear here when they are started."
              action={<Button variant="primary">Start an order</Button>}
            />
            <div className="y-gallery__skeletons" aria-label="Loading the menu" role="img">
              <Skeleton height={88} radius="card" />
              <Skeleton height={88} radius="card" />
              <Skeleton height={88} radius="card" />
            </div>
          </div>
        </Section>

        <Section id="gallery-approval" title="Ask a supervisor">
          <SupervisorApproval
            request="Give back TSh 9,500 in cash for 1 × Chocolate tart"
            supervisors={[
              { id: "staff-amina", name: "Amina Hassan", roleName: "Supervisor" },
              { id: "staff-grace", name: "Grace Mushi", roleName: "Manager" },
            ]}
            requesterId="staff-amina"
            selectedId="staff-amina"
            onSelect={() => undefined}
            pinLength={0}
            onPinKey={() => undefined}
            status={{ kind: "idle" }}
            onCancel={() => undefined}
          />
        </Section>
      </div>
    </div>
  );
}
