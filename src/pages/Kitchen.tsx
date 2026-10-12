import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeviceSession } from "../auth/DeviceSessionProvider";
import {
  useActiveOrders,
  useHasPermission,
  useStationTickets,
  useTransitionOrderStatus,
  useTransitionStationTicket,
} from "../hooks/usePosData";
import { KitchenBoard } from "../kitchen/KitchenBoard";
import { KITCHEN_CLOCK_TICK_SECONDS, KITCHEN_REFRESH_SECONDS } from "../kitchen/kitchenSettings";
import { ticketsFromOrders, ticketsFromStations, type BoardTicket } from "../kitchen/kitchenTickets";
import { kitchenProblem, nextStepFor, stationWords, stepDoneWords } from "../kitchen/kitchenWords";
import { normalizeMode } from "../lib/displayDefaults";
import { useHoldIdleLock } from "../lib/useHoldIdleLock";
import { isDisplayMode } from "../lib/workspace";

const ALL_STATIONS = "ALL";

function playNewTicketChime(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    void ctx.close();
  } catch {
    // Audio is best-effort on shared kitchen hardware.
  }
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** A step on its way to Yetu, held until Yetu's list shows the ticket moved. */
interface Held {
  /** The version the step was sent for. */
  version: number;
  /** Yetu took the step; false while the request is out. */
  taken: boolean;
}

/**
 * The kitchen and bar board against the live API. A kitchen or bar display
 * moves its station's tickets; a selling till moves whole orders, with the
 * time sent taken from the order's station tickets. Steps go only forwards,
 * one at a time (Yetu has no step back, so there is no Undo or Recall).
 */
export function Kitchen() {
  const { identity } = useDeviceSession();
  const display = isDisplayMode(identity?.mode);
  const orders = useActiveOrders();
  // The display's own tickets; on a selling till, where each order's sent time comes from.
  const stationTickets = useStationTickets(true);
  const transitionOrder = useTransitionOrderStatus();
  const transitionTicket = useTransitionStationTicket();
  const canMove = useHasPermission("pos.order.send");
  const nowMs = useNow(KITCHEN_CLOCK_TICK_SECONDS * 1000);
  const [station, setStation] = useState(ALL_STATIONS);
  const [held, setHeld] = useState<ReadonlyMap<string, Held>>(new Map());
  const [result, setResult] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // One key per request: asking again after a lost answer reuses it; a new step gets a new one.
  const keys = useRef(new Map<string, string>());
  const seenNew = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const source = display ? stationTickets : orders;
  const { refetch } = source;
  const tickets = useMemo<BoardTicket[]>(
    () => (display ? ticketsFromStations(stationTickets.data ?? []) : ticketsFromOrders(orders.data ?? [], stationTickets.data ?? [])),
    [display, orders.data, stationTickets.data],
  );

  // Ask again now and then, besides live updates.
  useEffect(() => {
    const id = window.setInterval(() => void refetch(), KITCHEN_REFRESH_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [refetch]);

  // A step Yetu took is let go once Yetu's list shows the ticket moved on (a
  // new version, or gone from the board). A list from before the step keeps
  // it held, so the same step can't be sent twice. It is checked again when
  // Yetu's answer arrives, as the list may already have shown the move.
  useEffect(() => {
    setHeld((current) => {
      let next: Map<string, Held> | null = null;
      for (const [id, entry] of current) {
        if (!entry.taken) continue;
        const ticket = tickets.find((candidate) => candidate.id === id);
        if (!ticket || ticket.version !== entry.version) {
          next ??= new Map(current);
          next.delete(id);
        }
      }
      return next ?? current;
    });
  }, [tickets, held]);

  // A chime for each ticket that arrives while the board is open.
  useEffect(() => {
    const fresh = tickets.filter((ticket) => ticket.status === "SENT").map((ticket) => ticket.id);
    if (!primed.current) {
      if (source.isSuccess) {
        fresh.forEach((id) => seenNew.current.add(id));
        primed.current = true;
      }
      return;
    }
    for (const id of fresh) {
      if (seenNew.current.has(id)) continue;
      seenNew.current.add(id);
      playNewTicketChime();
    }
  }, [tickets, source.isSuccess]);

  const pending = useMemo(() => [...held.values()].some((entry) => !entry.taken), [held]);
  // The till doesn't lock itself while a step is with Yetu.
  useHoldIdleLock(pending);

  const nextStep = useCallback(
    async (ticket: BoardTicket) => {
      const step = nextStepFor(ticket.status);
      if (!step) return;
      const request = [ticket.kind, ticket.id, step.target, ticket.version].join("|");
      const key = keys.current.get(request) ?? crypto.randomUUID();
      keys.current.set(request, key);
      setHeld((current) => new Map(current).set(ticket.id, { version: ticket.version, taken: false }));
      try {
        if (ticket.kind === "station") {
          await transitionTicket.mutateAsync({ ticketId: ticket.id, status: step.target, version: ticket.version, idempotencyKey: key });
        } else {
          await transitionOrder.mutateAsync({ orderId: ticket.id, status: step.target, version: ticket.version, idempotencyKey: key });
        }
        keys.current.delete(request);
        setHeld((current) => new Map(current).set(ticket.id, { version: ticket.version, taken: true }));
        setProblem(null);
        setResult(stepDoneWords(step.target, ticket.orderNumber, ticket.kind === "station" ? ticket.station : undefined));
      } catch (error) {
        setHeld((current) => {
          const next = new Map(current);
          next.delete(ticket.id);
          return next;
        });
        const refusal = kitchenProblem(error);
        setResult(null);
        setProblem(refusal?.words ?? "The ticket didn't move. Try again.");
        // Only a lost answer is asked again under the same key; a refusal makes the next press a new request.
        if (refusal?.kind !== "network") keys.current.delete(request);
        // It may have moved on another screen: the board shows where it is now.
        if (refusal?.kind === "moved") void refetch();
      }
    },
    [transitionOrder, transitionTicket, refetch],
  );

  const bound = useMemo(() => (identity?.prepStations ?? []).map((name) => name.trim().toUpperCase()).filter(Boolean), [identity?.prepStations]);
  const shown = display && station !== ALL_STATIONS ? tickets.filter((ticket) => ticket.station === station) : tickets;
  const title = normalizeMode(identity?.mode) === "BAR_DISPLAY" ? "Bar" : "Kitchen";

  return (
    <KitchenBoard
      title={title}
      stationsWords={display && bound.length > 0 ? bound.map(stationWords).join(" · ") : undefined}
      tickets={shown}
      nowMs={nowMs}
      busyIds={new Set(held.keys())}
      canMove={canMove}
      onNextStep={(ticket) => void nextStep(ticket)}
      result={result}
      problem={problem}
      loading={source.isLoading}
      failed={source.isError}
      stationFilter={
        display && bound.length > 1
          ? {
              options: [{ value: ALL_STATIONS, label: "All stations" }, ...bound.map((value) => ({ value, label: stationWords(value) }))],
              value: station,
              onChange: setStation,
            }
          : null
      }
    />
  );
}
