import { FIXTURE_PLACE } from "./fixturePlace";
import { useEffect, type ReactNode } from "react";
import { AccessFrame } from "../access/AccessLayout";
import { PIN_PAUSE_AFTER_FAILURES } from "../access/accessSettings";
import { IdleLockView } from "../components/IdleLockOverlay";
import { KeyStorageBannerView } from "../components/KeyStorageBanner";
import { UpdateBannerView } from "../components/UpdaterBanner";
import { StaffLoginRateLimitedError, StaffLoginRejectedError, humanDeviceError, type RosterEntry } from "../lib/deviceAuth";
import type { PairingRecord } from "../lib/deviceIdentity";
import { PairingView } from "../pages/PairingScreen";
import { PinUnlockView, type PinUnlockViewProps } from "../pages/PinUnlock";
import { SetupView } from "../pages/SetupScreen";
import { Splash } from "../pages/Splash";
import { ShellFixture } from "./ShellFixtures";

/**
 * Development-only compositions of the screens before a person is signed in,
 * for the pixel harness. They render the real screens (the views the live
 * containers use) inside the same frame the app puts around them, with data
 * in the shapes the device session holds. Nothing here talks to a server.
 */

const nothing = async () => undefined;

function Frame({ banners, children }: { banners?: ReactNode; children: ReactNode }) {
  return <AccessFrame banners={banners}>{children}</AccessFrame>;
}

/** STARTING: the till opening. */
export function SplashFixture() {
  return (
    <Frame>
      <Splash />
    </Frame>
  );
}

/** STARTING, taking longer than it should. */
export function SplashSlowFixture() {
  return (
    <Frame>
      <Splash slowAfterMs={0} />
    </Frame>
  );
}

/** UNCONFIGURED: no server address yet. */
export function SetupFixture() {
  return (
    <Frame>
      <SetupView error={null} onSave={nothing} />
    </Frame>
  );
}

/** UNCONFIGURED, after an address the till will not use. */
export function SetupProblemFixture() {
  useEffect(() => {
    document.querySelector<HTMLButtonElement>('[data-testid="save-peak-url"]')?.click();
  }, []);
  return (
    <Frame>
      <SetupView error={null} onSave={nothing} initialAddress="http://yetu.example.com" />
    </Frame>
  );
}

/** A code as the backend issues it: 10 characters in two groups, valid for 10 minutes. */
function pairingRecord(): PairingRecord {
  return {
    pairingRequestId: "9b2f6c1e-4f7a-4d2b-9e1a-3c5d7f9a1b2c",
    pairingCode: "7F3KQ-9ABCD",
    claimToken: "claim-fixture",
    fingerprint: "SHA256:3f9a2b7c4e1d8f60a5b9c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3",
    expiresAt: new Date(Date.now() + 581_000).toISOString(),
    qrPayload: "YETU-POS:1:7F3KQ-9ABCD",
  };
}

/** UNPROVISIONED: no code yet. */
export function PairingFixture() {
  return (
    <Frame>
      <PairingView pairing={null} waiting={false} error={null} onStart={nothing} onCancel={nothing} onNewCode={nothing} />
    </Frame>
  );
}

/** PAIRING: the code is shown and a manager has not approved yet. */
export function PairingWaitingFixture() {
  return (
    <Frame>
      <PairingView pairing={pairingRecord()} waiting error={null} onStart={nothing} onCancel={nothing} onNewCode={nothing} />
    </Frame>
  );
}

/** UNPROVISIONED after a manager declined the till. */
export function PairingDeclinedFixture() {
  return (
    <Frame>
      <PairingView
        pairing={null}
        waiting={false}
        error="This pairing was denied. Generate a new code."
        onStart={nothing}
        onCancel={nothing}
        onNewCode={nothing}
      />
    </Frame>
  );
}

const NAMES = [
  "Amina Hassan",
  "Grace Mushi",
  "Juma Ally",
  "Neema Mwakyusa",
  "Baraka Mollel",
  "Rehema Swai",
  "Daudi Kimaro",
  "Halima Said",
  "Elia Massawe",
  "Furaha Lyimo",
  "Saidi Mrisho",
  "Zawadi Chuwa",
  "Tumaini Njau",
  "Upendo Lema",
  "Joseph Temba",
  "Mwanaisha Juma",
];

/** Staff as the device session holds them: a name and the id the till signs in with. */
function rosterOf(count: number): RosterEntry[] {
  return NAMES.slice(0, count).map((fullName, index) => ({
    fullName,
    staffNumber: `5d3c${String(index).padStart(4, "0")}-0f1e-4a2b-8c9d-0e1f2a3b4c5d`,
  }));
}

function Locked(props: Partial<PinUnlockViewProps> & { banners?: ReactNode }) {
  const { banners, ...rest } = props;
  return (
    <Frame banners={banners}>
      <PinUnlockView
        place={FIXTURE_PLACE}
        roster={rosterOf(6)}
        offlineState="ELIGIBLE"
        error={null}
        online
        onUnlock={nothing}
        {...rest}
      />
    </Frame>
  );
}

/** LOCKED: who's working. */
export function LockedRosterFixture() {
  return <Locked />;
}

/** LOCKED with more people than fit: a search appears. */
export function LockedRosterSearchFixture() {
  return <Locked roster={rosterOf(16)} />;
}

/** LOCKED: a person chose their name and is entering their PIN. */
export function LockedPinFixture() {
  return <Locked initialStaff={rosterOf(1)[0]} />;
}

/** LOCKED after a PIN that didn't match. */
export function LockedPinWrongFixture() {
  return <Locked initialStaff={rosterOf(1)[0]} error={humanDeviceError(new StaffLoginRejectedError())} initialFailures={1} />;
}

/** LOCKED once the backend has paused the PIN. */
export function LockedPinPausedFixture() {
  return (
    <Locked
      initialStaff={rosterOf(1)[0]}
      error={humanDeviceError(new StaffLoginRejectedError())}
      initialFailures={PIN_PAUSE_AFTER_FAILURES}
    />
  );
}

/** LOCKED: signing in by staff number. */
export function LockedManualFixture() {
  return <Locked initialManual />;
}

/** LOCKED with no network: the offline notice. */
export function LockedOfflineFixture() {
  return <Locked online={false} />;
}

/** LOCKED after a session ended. */
export function LockedSessionEndedFixture() {
  return <Locked error="Session expired — enter your PIN again" />;
}

/** LOCKED with the update and key-storage notices above the screen. */
export function AccessBannersFixture() {
  return (
    <Locked
      banners={
        <>
          <UpdateBannerView state="ready" />
          <KeyStorageBannerView detail="Secure storage unavailable: using an encrypted file instead (keyring error 0x80070490)" />
        </>
      }
    />
  );
}

/** READY, about to lock after a quiet spell. */
export function IdleLockFixture() {
  return (
    <>
      <ShellFixture />
      <IdleLockView remaining={8} />
    </>
  );
}

/** LOCKED after too many sign-in attempts (429): the keypad waits until Yetu allows the next one. */
export function LockedPinHeldFixture() {
  return (
    <Locked
      initialStaff={rosterOf(1)[0]}
      error={humanDeviceError(new StaffLoginRateLimitedError(1_800))}
      heldUntil={Date.now() + 1_800_000}
    />
  );
}
