import type { ComponentType } from "react";
import { isVisualFixtureName, type VisualFixtureName } from "./fixtureNames";
import {
  AccessBannersFixture,
  IdleLockFixture,
  LockedManualFixture,
  LockedOfflineFixture,
  LockedPinFixture,
  LockedPinPausedFixture,
  LockedPinWrongFixture,
  LockedRosterFixture,
  LockedRosterSearchFixture,
  LockedSessionEndedFixture,
  PairingDeclinedFixture,
  PairingFixture,
  PairingWaitingFixture,
  SetupFixture,
  SetupProblemFixture,
  SplashFixture,
  SplashSlowFixture,
} from "./JourneyFixtures";
import {
  CashFixture,
  CashInFixture,
  CashNoPermissionFixture,
  CashOutFixture,
  CloseBalancedFixture,
  CloseCountFixture,
  CloseOverFixture,
  DayCloseBlockedFixture,
  NoShiftFixture,
  NoteCounterFixture,
  OpenShiftManagerFixture,
  OpenShiftNoPermissionFixture,
} from "./CashFixtures";
import { PeakTerminalFixture } from "./PeakTerminalFixture";
import {
  ApprovalSheetFixture,
  CommandSearchFixture,
  ShellFixture,
  ShellKitchenDisplayFixture,
  ShellOfflineFixture,
} from "./ShellFixtures";
import { SystemGalleryFixture } from "./SystemGallery";

const FIXTURES: Record<VisualFixtureName, ComponentType> = {
  splash: SplashFixture,
  "splash-slow": SplashSlowFixture,
  setup: SetupFixture,
  "setup-problem": SetupProblemFixture,
  pairing: PairingFixture,
  "pairing-waiting": PairingWaitingFixture,
  "pairing-declined": PairingDeclinedFixture,
  "locked-roster": LockedRosterFixture,
  "locked-roster-search": LockedRosterSearchFixture,
  "locked-pin": LockedPinFixture,
  "locked-pin-wrong": LockedPinWrongFixture,
  "locked-pin-paused": LockedPinPausedFixture,
  "locked-manual": LockedManualFixture,
  "locked-offline": LockedOfflineFixture,
  "locked-session-ended": LockedSessionEndedFixture,
  "access-banners": AccessBannersFixture,
  "idle-lock": IdleLockFixture,
  "no-shift": NoShiftFixture,
  "open-shift-manager": OpenShiftManagerFixture,
  "open-shift-no-permission": OpenShiftNoPermissionFixture,
  "day-close-blocked": DayCloseBlockedFixture,
  "note-counter": NoteCounterFixture,
  cash: CashFixture,
  "cash-no-permission": CashNoPermissionFixture,
  "cash-in": CashInFixture,
  "cash-out": CashOutFixture,
  "close-count": CloseCountFixture,
  "close-balanced": CloseBalancedFixture,
  "close-over": CloseOverFixture,
  terminal: PeakTerminalFixture,
  system: SystemGalleryFixture,
  shell: ShellFixture,
  "shell-offline": ShellOfflineFixture,
  "shell-kds": ShellKitchenDisplayFixture,
  "approval-sheet": ApprovalSheetFixture,
  "command-search": CommandSearchFixture,
};

export function resolveVisualFixture(name: string): ComponentType | null {
  return isVisualFixtureName(name) ? FIXTURES[name] : null;
}
