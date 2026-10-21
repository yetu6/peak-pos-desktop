import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDeviceSessionOptional } from "../auth/DeviceSessionProvider";
import type { Supervisor } from "../components/system";
import type { RosterEntry } from "../lib/deviceAuth";
import { getOperationalSession } from "../lib/operationalSession";
import { createPosApi } from "../lib/posApi";
import type { ApprovalKind, POSApprover } from "../lib/posContracts";

/** Named setting: how long the till trusts its list of approvers before asking Yetu again. */
export const APPROVERS_FRESH_MS = 60_000;

const NOUN: Record<ApprovalKind, string> = {
  VOID: "cancellations",
  REFUND: "refunds",
  DISCOUNT: "discounts",
  CASH_OUT: "cash-outs",
  SHIFT_VARIANCE: "a shift that closes with a cash difference",
};

/** When no one may approve this kind here: what to do, in words. */
export function noApproverWords(kind: ApprovalKind): string {
  return `No one is set to approve ${NOUN[kind]} here yet. The owner chooses in Team rules.`;
}

/**
 * The people an approval sheet offers (F-249): the till's staff list,
 * narrowed to those Yetu says can approve this kind here. Before Yetu has
 * answered (offline, or a Yetu from before F-249), everyone, as before.
 */
export function supervisorsFor(roster: readonly RosterEntry[], approvers: readonly POSApprover[] | null, kind: ApprovalKind): Supervisor[] {
  const everyone = roster.map((entry) => ({ id: entry.staffNumber, name: entry.fullName }));
  if (!approvers) return everyone;
  const allowed = new Set(approvers.filter((approver) => approver.approves.includes(kind)).map((approver) => approver.staffId));
  return everyone.filter((person) => allowed.has(person.id));
}

/** Yetu's approvers here, or null until it has answered (or when it can't). */
export function useApprovers(): POSApprover[] | null {
  const session = getOperationalSession();
  const offlineCash = session?.mode === "offline-cash";
  const approvers = useQuery({
    queryKey: ["pos", "approvers", session?.propertyId ?? "", session?.outletId ?? ""],
    queryFn: async () => {
      const { data, error } = await createPosApi().getApprovers();
      if (error || !data) throw new Error("approvers unavailable");
      return data.approvers;
    },
    enabled: Boolean(session?.token) && !offlineCash,
    staleTime: APPROVERS_FRESH_MS,
    retry: false,
  });
  return approvers.data ?? null;
}

/** The supervisors one approval sheet offers, and its words when there are none. */
export function supervisorChoice(
  roster: readonly RosterEntry[],
  approvers: readonly POSApprover[] | null,
  kind: ApprovalKind,
): { supervisors: Supervisor[]; emptyWords: string | undefined } {
  const supervisors = supervisorsFor(roster, approvers, kind);
  return { supervisors, emptyWords: approvers && supervisors.length === 0 ? noApproverWords(kind) : undefined };
}

/** The supervisors for one kind of approval, from the till's staff list and Yetu's approvers. */
export function useSupervisors(kind: ApprovalKind): { supervisors: Supervisor[]; emptyWords: string | undefined } {
  const device = useDeviceSessionOptional();
  const roster = device?.roster;
  const approvers = useApprovers();
  return useMemo(() => supervisorChoice(roster ?? [], approvers, kind), [roster, approvers, kind]);
}
