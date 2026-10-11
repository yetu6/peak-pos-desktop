import type { ComponentType } from "react";
import { isVisualFixtureName, type VisualFixtureName } from "./fixtureNames";
import {
  LockedPinFixture,
  LockedRosterFixture,
  NoShiftFixture,
  PairingFixture,
  PairingWaitingFixture,
  SplashFixture,
} from "./JourneyFixtures";
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
  pairing: PairingFixture,
  "pairing-waiting": PairingWaitingFixture,
  "locked-roster": LockedRosterFixture,
  "locked-pin": LockedPinFixture,
  "no-shift": NoShiftFixture,
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
