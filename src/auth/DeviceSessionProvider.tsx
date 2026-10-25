import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ROSTER_REFRESH_SECONDS } from "../access/accessSettings";
import { applyOpsTokenToBridge } from "../lib/applyOpsToken";
import { usesRealtimeBridge } from "../lib/peakSocket";
import {
  createStaffSession,
  deviceCredentialDigest,
  DeviceNotApprovedError,
  DeviceRevokedError,
  fetchLockScreen,
  generateDeviceCredential,
  getPairingStatus,
  humanDeviceError,
  isDeviceNetworkFailure,
  requestPairing,
  sendHeartbeat,
  StaffLoginRateLimitedError,
  StaffLoginRejectedError,
  StaffNewPinRefusedError,
  StaffPinSetupRequiredError,
  StaffSetupCodeExpiredError,
  type RosterEntry,
} from "../lib/deviceAuth";
import { generateDeviceKeyPair, rawPublicKeyB64Url } from "../lib/deviceCrypto";
import {
  loadNativeDeviceAuthority,
  type DeviceAuthority,
} from "../lib/nativeDeviceAuthority";
import {
  loadDeviceIdentity,
  loadDeviceKeyStorageStatus,
  saveDeviceIdentity,
  type DeviceIdentityRecord,
  type SecretStore,
} from "../lib/deviceIdentity";
import { useQueryClient } from "@tanstack/react-query";
import { REALTIME_BRIDGE_URL } from "../lib/env";
import { getApiBaseUrl, loadPeakApiUrl, savePeakApiUrl } from "../lib/peakConfig";
import {
  clearOperationalSession,
  getOperationalSession,
  SessionExpiredError,
  setOperationalSession,
  type OperationalSession,
} from "../lib/operationalSession";
import { bootstrapOperationalSession, prepareOfflineStart } from "../lib/postLoginBootstrap";
import {
  loadNativeOfflineAuthority,
  type OfflineAuthority,
  type OfflineEligibilityStatus,
  type TerminalBinding,
} from "../lib/offlineAuthorization";
import { loadLocalPosCore, type LocalPosCore } from "../lib/localPosCore";

/**
 * Shared-terminal shell. DEVICE pairing persists across waiters.
 * STAFF (ops) session is transient. TILL/SHIFT is a separate cashier
 * session in localStorage — Switch Staff must not close it.
 */
export type AppShellState = "UNPAIRED" | "PAIRED_LOCKED" | "OPERATIONAL";

export type DevicePhase =
  | "bootstrapping"
  | "needs-url"
  | "unpaired"
  | "waiting"
  | "locked"
  | "ready";

export function shellStateOf(phase: DevicePhase): AppShellState {
  if (phase === "ready") return "OPERATIONAL";
  if (phase === "locked") return "PAIRED_LOCKED";
  return "UNPAIRED";
}

/**
 * What a sign-in attempt asks of the PIN screen next, when it is more than
 * showing `error`: a new person's setup code was right and they choose their
 * own PIN now, or Yetu refused the PIN they chose and said why.
 */
export type UnlockOutcome =
  | { next: "choose-pin" }
  | { next: "choose-again"; words: string };

export interface DeviceSessionValue {
  phase: DevicePhase;
  shell: AppShellState;
  identity: DeviceIdentityRecord | null;
  session: OperationalSession | null;
  error: string | null;
  saveApiUrl: (url: string) => Promise<void>;
  startPairing: () => Promise<void>;
  continueAfterApproval: () => Promise<void>;
  resetPairing: () => Promise<void>;
  /** `newPin`: with a setup code as `pin`, the PIN the person chose to sign in with from now on. */
  unlock: (staffNumber: string, pin: string, newPin?: string) => Promise<UnlockOutcome | undefined>;
  /** End the waiter ops session. Does not unpair or close the cashier till. */
  switchStaff: (reason?: string) => void;
  /** Present when the OS secure-store boundary cannot provide hardware-backed storage. */
  keyStorageWarning: string | null;
  /** Tap-to-select staff for this till's own property. Empty when unavailable — never blocks
   *  PIN entry; manual staff-number entry always remains the fallback. */
  roster: RosterEntry[];
  refreshRoster: () => Promise<void>;
  /** Asks Yetu again for the till's offline start-up, for when a shift has opened since sign-in (F-228). */
  prepareOffline: () => Promise<void>;
  offlineEligibility: OfflineEligibilityStatus | null;
  /** After too many sign-in attempts (429): when Yetu allows the next one (ms since the epoch). */
  signInHeldUntil: number | null;
}

const DeviceSessionContext = createContext<DeviceSessionValue | null>(null);

export interface DeviceSessionProviderProps {
  children: ReactNode;
  store?: SecretStore;
  baseUrl?: string;
  bridgeUrl?: string;
  applyOpsToken?: (token: string) => Promise<void>;
  /** Tests inject a Peak URL so the first-boot setup screen is skipped. */
  skipUrlSetup?: boolean;
  /** Idle seconds before PIN lock. Peak `expiresAt` still locks independently. */
  idleLockSeconds?: number;
  deviceAuthority?: DeviceAuthority;
  offlineAuthority?: OfflineAuthority;
  localPosCore?: LocalPosCore;
}

/** Pairing contract: 2s for the first 60s, then 5s, never slower than 15s. */
function pairingPollDelay(elapsedMs: number): number {
  if (elapsedMs < 60_000) return 2_000;
  if (elapsedMs < 180_000) return 5_000;
  return 15_000;
}

const HEARTBEAT_MS = 60_000;

export function DeviceSessionProvider({
  children,
  store,
  baseUrl,
  bridgeUrl = REALTIME_BRIDGE_URL,
  applyOpsToken = (token) => usesRealtimeBridge() ? applyOpsTokenToBridge(token, bridgeUrl) : Promise.resolve(),
  skipUrlSetup = Boolean(baseUrl),
  deviceAuthority,
  offlineAuthority,
  localPosCore,
}: DeviceSessionProviderProps) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<DevicePhase>("bootstrapping");
  const [identity, setIdentity] = useState<DeviceIdentityRecord | null>(null);
  const [session, setSession] = useState<OperationalSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState<string | null>(baseUrl ?? null);
  const [keyStorageWarning, setKeyStorageWarning] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [offlineEligibility, setOfflineEligibility] =
    useState<OfflineEligibilityStatus | null>(null);
  const [signInHeldUntil, setSignInHeldUntil] = useState<number | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef(identity);
  const authorityRef = useRef<DeviceAuthority | null>(deviceAuthority ?? null);
  const offlineAuthorityRef = useRef<OfflineAuthority | null>(offlineAuthority ?? null);
  const localPosCoreRef = useRef<LocalPosCore | null>(localPosCore ?? null);
  identityRef.current = identity;

  const peakUrl = baseUrl ?? apiUrl ?? getApiBaseUrl();

  const refreshKeyStorageStatus = useCallback(async () => {
    if (store) {
      setKeyStorageWarning(null);
      return;
    }
    const status = await loadDeviceKeyStorageStatus();
    setKeyStorageWarning(status && !status.hardwareBacked ? status.warning : null);
  }, [store]);

  const persist = useCallback(
    async (next: DeviceIdentityRecord) => {
      await saveDeviceIdentity(next, store);
      identityRef.current = next;
      setIdentity(next);
      await refreshKeyStorageStatus();
    },
    [store, refreshKeyStorageStatus],
  );

  const clearExpiry = useCallback(() => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    expiryTimer.current = null;
  }, []);

  const clearStaffAuthority = useCallback(() => {
    clearExpiry();
    clearOperationalSession();
    setSession(null);
    queryClient.clear();
    void offlineAuthorityRef.current?.clearStaffSession().catch(() => undefined);
    void applyOpsToken("").catch(() => undefined);
  }, [applyOpsToken, clearExpiry, queryClient]);

  const switchStaff = useCallback(
    (reason?: string) => {
      clearStaffAuthority();
      // Do not touch the cashier till id in localStorage and do not unpair.
      setPhase("locked");
      setError(reason ?? null);
    },
    [clearStaffAuthority],
  );

  const armExpiry = useCallback(
    (next: OperationalSession) => {
      clearExpiry();
      const expiresAt = Date.parse(next.expiresAt);
      if (!Number.isFinite(expiresAt)) return;
      const delay = Math.max(0, expiresAt - Date.now());
      // browsers clamp setTimeout to a signed 32-bit int; a far-future Peak
      // expiry must not fire in 1ms and lock the till.
      if (delay > 2_147_483_647) return;
      expiryTimer.current = setTimeout(
        () => switchStaff("Session expired — enter your PIN again"),
        delay,
      );
    },
    [clearExpiry, switchStaff],
  );

  const loadRoster = useCallback(async () => {
    const current = identityRef.current;
    if (!current?.deviceCode) {
      setRoster([]);
      return;
    }
		const terminalId = current.terminalId ?? current.deviceCode;
		const credential = current.deviceCredential ?? current.deviceCode;
		if (!terminalId || !credential) { setRoster([]); return; }
    const { staff: online, place } = await fetchLockScreen(peakUrl, terminalId, credential);
    // The names as Yetu has them now: a till renamed in Yetu shows its new name here (F-252).
    const latest = identityRef.current;
    if (
      latest &&
      ((place.tillName && place.tillName !== latest.terminalName) ||
        (place.propertyName && place.propertyName !== latest.propertyName) ||
        (place.outletName && place.outletName !== latest.outletName))
    ) {
      await persist({
        ...latest,
        terminalName: place.tillName ?? latest.terminalName,
        propertyName: place.propertyName ?? latest.propertyName,
        outletName: place.outletName ?? latest.outletName,
      });
    }
    if(online.length>0){setRoster(online);return}
    const local=await offlineAuthorityRef.current?.staffRoster?.().catch(()=>[]);
    setRoster((local??[]).map(entry=>({fullName:entry.displayName,staffNumber:entry.staffId})));
  }, [peakUrl, persist]);

  // Each refresh asks Yetu for a challenge, a row it writes. The till coming to
  // the front fires focus and visibilitychange together, which sent two at once
  // (18:58:54 and 18:59:04 on 2026-10-20). A refresh asked for while one is with
  // Yetu shares it.
  const rosterInFlight = useRef<Promise<void> | null>(null);
  const refreshRoster = useCallback(() => {
    rosterInFlight.current ??= loadRoster().finally(() => {
      rosterInFlight.current = null;
    });
    return rosterInFlight.current;
  }, [loadRoster]);

  useEffect(() => {
    if (phase !== "locked") return;
    void refreshRoster();
    // Staff added or given a PIN while the till waits here appear without a restart (F-227).
    const again = () => {
      if (document.visibilityState !== "hidden") void refreshRoster();
    };
    const timer = window.setInterval(again, ROSTER_REFRESH_SECONDS * 1000);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [phase, refreshRoster]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const storedUrl = skipUrlSetup ? (baseUrl ?? (await loadPeakApiUrl())) : await loadPeakApiUrl();
      if (!skipUrlSetup && !storedUrl) {
        if (!cancelled) setPhase("needs-url");
        return;
      }
      if (storedUrl && !cancelled) setApiUrl(storedUrl);

      let record = await loadDeviceIdentity(store);
      if (!record) {
        if (store) {
          record = await generateDeviceKeyPair();
        } else {
          authorityRef.current ??= await loadNativeDeviceAuthority();
          record = await authorityRef.current.ensureIdentity();
        }
        await saveDeviceIdentity(record, store);
      }
      if (cancelled) return;
      await refreshKeyStorageStatus();
      if (cancelled) return;
      setIdentity(record);
      if (record.approved && (record.terminalId || record.deviceCode) && (record.deviceCredential || record.deviceCode)) {
        if (!store) {
          try {
            offlineAuthorityRef.current ??= await loadNativeOfflineAuthority();
            setOfflineEligibility(
              await offlineAuthorityRef.current.eligibilityStatus(),
            );
          } catch {
            setOfflineEligibility({ state: "STORAGE_UNHEALTHY" });
          }
        }
        setPhase("locked");
        return;
      }
      if (
        record.pairing &&
        record.pairing.claimToken &&
        record.deviceCredential &&
        Date.parse(record.pairing.expiresAt) > Date.now()
      ) {
        setPhase("waiting");
        return;
      }
      if (!record.approved && (record.pairing || record.deviceCredential)) {
        record = {
          privateKeyPkcs8: record.privateKeyPkcs8,
          publicKeySpki: record.publicKeySpki,
          publicKey: record.publicKey,
          approved: false,
        };
        await saveDeviceIdentity(record, store);
        identityRef.current = record;
        setIdentity(record);
      }
      setPhase("unpaired");
    })();
    return () => {
      cancelled = true;
      clearExpiry();
    };
  }, [store, clearExpiry, skipUrlSetup, baseUrl, refreshKeyStorageStatus]);

  const saveApiUrl = useCallback(
    async (url: string) => {
      setError(null);
      try {
        const saved = await savePeakApiUrl(url);
        setApiUrl(saved);
        let record = identityRef.current ?? (await loadDeviceIdentity(store));
        if (!record) {
          if (store) {
            record = await generateDeviceKeyPair();
          } else {
            authorityRef.current ??= await loadNativeDeviceAuthority();
            record = await authorityRef.current.ensureIdentity();
          }
          await persist(record);
        } else {
          setIdentity(record);
        }
        setPhase("unpaired");
      } catch (err) {
        setError(humanDeviceError(err));
        throw err;
      }
    },
    [persist, store],
  );

  const startPairing = useCallback(async () => {
    const current = identityRef.current;
    if (!current) return;
    setError(null);
    try {
      const deviceCredential = generateDeviceCredential();
      const credentialHash = await deviceCredentialDigest(deviceCredential);
      const issued = await requestPairing(
        peakUrl,
        current.publicKey ?? rawPublicKeyB64Url(current.publicKeySpki ?? ""),
        credentialHash,
      );
      await persist({
        ...current,
        deviceCode: undefined,
        terminalId: undefined,
        deviceCredential,
        approved: false,
        pairing: {
          pairingRequestId: issued.pairingRequestId,
          pairingCode: issued.pairingCode,
          claimToken: issued.claimToken,
          fingerprint: issued.fingerprint,
          expiresAt: issued.expiresAt,
          qrPayload: issued.qrPayload ?? `YETU-POS:1:${issued.pairingCode}`,
        },
      });
      setPhase("waiting");
    } catch (err) {
      setError(humanDeviceError(err));
    }
  }, [peakUrl, persist]);

  const markApproved = useCallback(
    async (terminalId: string, binding?: TerminalBinding, mode?: string) => {
      const current = identityRef.current;
      if (!current?.deviceCredential) return;
      if (binding) {
        offlineAuthorityRef.current ??= await loadNativeOfflineAuthority();
        await offlineAuthorityRef.current.bindTerminal(binding);
        setOfflineEligibility(
          await offlineAuthorityRef.current.eligibilityStatus(),
        );
      }
      await persist({
        ...current,
        deviceCode: terminalId,
        terminalId,
        approved: true,
        mode: mode?.trim() || current.mode || "POS",
        pairing: undefined,
      });
      setPhase("locked");
    },
    [persist],
  );

  const continueAfterApproval = useCallback(async () => {
    const current = identityRef.current;
    const pairing = current?.pairing;
    if (!current || !pairing?.pairingRequestId || !pairing.claimToken || !current.deviceCredential) {
      setError("Not approved yet. Ask a manager to enter this pairing code.");
      return;
    }
    setError(null);
    try {
      const status = await getPairingStatus(
        peakUrl,
        pairing.pairingRequestId,
        pairing.claimToken,
      );
      if (status.status === "CONSUMED" && status.terminalId) {
        await markApproved(status.terminalId, status.offlineAuthority, status.mode);
        return;
      }
      if (status.status === "PENDING") {
        setPhase("waiting");
        return;
      }
      await persist({
        ...current,
        approved: false,
        pairing: undefined,
        deviceCredential: undefined,
        terminalId: undefined,
        deviceCode: undefined,
      });
      setPhase("unpaired");
      setError(status.status === "REJECTED"
        ? "This pairing was denied. Generate a new code."
        : "This code expired. Generate a new one.");
    } catch (err) {
      setError(humanDeviceError(err));
    }
  }, [markApproved, peakUrl, persist]);

  const resetPairing = useCallback(async () => {
    const current = identityRef.current;
    if (!current) return;
    clearStaffAuthority();
    await persist({
      privateKeyPkcs8: current.privateKeyPkcs8,
      publicKeySpki: current.publicKeySpki,
      publicKey: current.publicKey,
      approved: false,
    });
    setRoster([]);
    setError(null);
    setPhase("unpaired");
  }, [clearStaffAuthority, persist]);

  useEffect(() => {
    if (phase !== "waiting") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      const pairing = identityRef.current?.pairing;
      if (!pairing?.pairingRequestId || !pairing.claimToken) {
        setPhase("unpaired");
        return;
      }
      if (Date.parse(pairing.expiresAt) <= Date.now()) {
        await resetPairing();
        if (!cancelled) setError("This code expired. Generate a new one.");
        return;
      }
      try {
        await continueAfterApproval();
      } catch (err) {
        if (!cancelled) setError(humanDeviceError(err));
      }
      if (!cancelled && identityRef.current?.pairing) {
        timer = setTimeout(() => void tick(), pairingPollDelay(Date.now() - startedAt));
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [continueAfterApproval, phase, resetPairing]);

  // Presence for Hospitality Web connectivity badges — device credential only.
  // Failures are best-effort: a mocked or flaky heartbeat must never tear down
  // a valid pairing or mid-PIN session. Revocation still surfaces on the next
  // challenge / unlock attempt.
  useEffect(() => {
    if (phase !== "locked" && phase !== "ready") return;
    const terminalId = identity?.terminalId ?? identity?.deviceCode;
    const credential = identity?.deviceCredential ?? identity?.deviceCode;
    if (!identity?.approved || !terminalId || !credential) return;
    let cancelled = false;

    const beat = async () => {
      if (cancelled) return;
      try {
        await sendHeartbeat(peakUrl, terminalId, credential);
      } catch {
        // Best-effort presence only.
      }
    };

    void beat();
    const id = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    identity?.approved,
    identity?.deviceCode,
    identity?.deviceCredential,
    identity?.terminalId,
    peakUrl,
    phase,
  ]);

  const prepareOffline = useCallback(async () => {
    const current = getOperationalSession();
    const core = localPosCoreRef.current;
    if (!current || !core) return;
    try {
      await prepareOfflineStart(peakUrl, current, {
        installTrustKeyset: () => core.retrySync(peakUrl, current.token),
        installOfflineBootstrap: (terminalId, propertyId, outletId, bootstrap) => core.installBootstrap(terminalId, propertyId, outletId, bootstrap),
      });
      if (offlineAuthorityRef.current) setOfflineEligibility(await offlineAuthorityRef.current.eligibilityStatus(current.staffId));
    } catch {
      // Best effort, like at sign-in: the till works online without it.
    }
  }, [peakUrl]);

  const unlock = useCallback(
    async (staffNumber: string, pin: string, newPin?: string): Promise<UnlockOutcome | undefined> => {
      const current = identityRef.current;
		if (!current || !(current.terminalId || current.deviceCode) || !(current.deviceCredential || current.deviceCode)) return undefined;
      clearStaffAuthority();
      setError(null);
      try {
        if (!current.privateKeyPkcs8) {
          authorityRef.current ??= await loadNativeDeviceAuthority();
        }
        const next = await createStaffSession({
          baseUrl: peakUrl,
			deviceCode: current.deviceCode,
			terminalId: current.terminalId ?? current.deviceCode,
			deviceCredential: current.deviceCredential ?? current.deviceCode,
          privateKeyPkcs8: current.privateKeyPkcs8,
          signChallenge: current.privateKeyPkcs8
            ? undefined
            : authorityRef.current?.signChallenge,
          staffNumber,
          pin,
          newPin,
          previouslyApproved: current.approved === true,
        });
        if (!store) {
          offlineAuthorityRef.current ??= await loadNativeOfflineAuthority();
          localPosCoreRef.current ??= await loadLocalPosCore();
        }
        const bootstrap = await bootstrapOperationalSession(peakUrl, next, {
          installTrustKeyset: localPosCoreRef.current
            ? () => localPosCoreRef.current!.retrySync(peakUrl, next.token)
            : undefined,
          installOfflineBootstrap: localPosCoreRef.current
            ? (terminalId, propertyId, outletId, bootstrap) => localPosCoreRef.current!.installBootstrap(terminalId, propertyId, outletId, bootstrap)
            : undefined,
          stageOfflineAuthorization: offlineAuthorityRef.current
            ? (envelope) => offlineAuthorityRef.current!.stageAuthorization(envelope)
            : undefined,
          installCatalogSnapshot: localPosCoreRef.current
            ? (envelope) => localPosCoreRef.current!.installCatalog(envelope)
            : undefined,
        });
        // A terminal can be fully, legitimately ONLINE-only — no shift open
        // yet, a momentary hiccup fetching the lease, or a property that has
        // never needed offline authority at all. `offlineAuthorityRef.current`
        // only tells us the native offline-authority module loaded, not that
        // bootstrap actually staged a real bundle above; gating on it alone
        // previously meant a real, successful PIN login (`/pos/sessions`
        // already succeeded) could still be thrown away as "Something went
        // wrong" whenever this purely-optional local pre-cache step had
        // nothing to authenticate against. This pre-cache is best-effort:
        // its own failure must never undo an already-successful online login.
        const offlineAuthorityReady =
          offlineAuthorityRef.current &&
          (bootstrap.offlineAuthorization?.state === "STAGED" ||
            bootstrap.offlineAuthorization?.state === "ACTIVE");
        if (offlineAuthorityReady) {
          try {
            // Offline the person signs in with their own PIN, never a spent setup code.
            await offlineAuthorityRef.current!.authenticateStaff(next.staffId, newPin ?? pin);
            setOfflineEligibility(
              await offlineAuthorityRef.current!.eligibilityStatus(next.staffId),
            );
          } catch {
            // The online session above is already valid and paid for;
            // offline readiness simply stays whatever it already was.
          }
        }
        try {
          await applyOpsToken(next.token);
        } catch {
          // REST can proceed; the connectivity pill will show if the socket fails.
        }
        setOperationalSession(next);
        setSession(next);
        await persist({
          ...current,
          approved: true,
          pairing: undefined,
          mode: next.mode ?? current.mode,
          prepStations: next.prepStations ?? current.prepStations,
          terminalName: next.terminalName ?? current.terminalName,
          propertyName: next.propertyName ?? current.propertyName,
          outletName: next.outletName ?? current.outletName,
        });
        armExpiry(next);
        setPhase("ready");
        // No longer new: the list loses its "New" before anyone comes back to it.
        if (newPin) void refreshRoster();
        return undefined;
      } catch (err) {
        clearStaffAuthority();
        if (err instanceof StaffPinSetupRequiredError) return { next: "choose-pin" };
        if (err instanceof StaffNewPinRefusedError) return { next: "choose-again", words: err.words };
        if (err instanceof DeviceRevokedError) {
          await persist({
            ...current,
            approved: false,
            deviceCode: undefined,
            terminalId: undefined,
            deviceCredential: undefined,
            mode: undefined,
            pairing: undefined,
          });
          setPhase("unpaired");
          setError(humanDeviceError(err));
          return;
        }
        if (err instanceof DeviceNotApprovedError) {
          setPhase("waiting");
          setError(humanDeviceError(err));
          return;
        }
        if (err instanceof StaffLoginRateLimitedError) {
          // Yetu limits attempts from this address: wait as long as it asked. Not a lost connection,
          // so never the offline sign-in.
          setSignInHeldUntil(Date.now() + err.retryAfterSeconds * 1000);
          setError(humanDeviceError(err));
          return;
        }
        if (
          err instanceof StaffLoginRejectedError ||
          err instanceof StaffSetupCodeExpiredError ||
          err instanceof SessionExpiredError
        ) {
          setError(err instanceof SessionExpiredError
            ? "Session expired — enter your PIN again"
            : humanDeviceError(err));
          return;
        }
        if (isDeviceNetworkFailure(err) && offlineAuthorityRef.current) {
          try {
            const local = await offlineAuthorityRef.current.authenticateStaff(
              staffNumber.trim(),
              pin,
            );
            const eligibility = await offlineAuthorityRef.current.eligibilityStatus(
              staffNumber.trim(),
            );
            setOfflineEligibility(eligibility);
            if (local.state === "AUTHENTICATED"&&local.staffId&&local.terminalId&&local.propertyId&&local.outletId&&local.expiresAtMs) {
              const offlineSession:OperationalSession={
                token:"",
                expiresAt:new Date(local.expiresAtMs).toISOString(),
                tenantId:"offline-local",
                propertyId:local.propertyId,
                outletId:local.outletId,
                terminalId:local.terminalId,
                staffId:local.staffId,
                assurance:"RESTRICTED",
                mode:"offline-cash",
                terminalName:current.terminalName,
                propertyName:current.propertyName,
                outletName:current.outletName,
                capabilities:["CORE","POS"],
                permissions:local.permissions??[],
              };
              setOperationalSession(offlineSession);
              setSession(offlineSession);
              armExpiry(offlineSession);
              setPhase("ready");
              return;
            } else if (local.state === "LOCKED") {
              setError("Offline PIN locked. Reconnect to Peak or wait before retrying.");
            } else if (local.state === "DENIED") {
              setError("That staff number or offline PIN was not accepted.");
            } else {
              setError(offlineEligibilityMessage(eligibility.state));
            }
            return;
          } catch {
            setOfflineEligibility({ state: "STORAGE_UNHEALTHY" });
          }
        }
        setError(humanDeviceError(err));
      }
    },
    [applyOpsToken, armExpiry, clearStaffAuthority, peakUrl, persist, refreshRoster],
  );

  const value = useMemo<DeviceSessionValue>(
    () => ({
      phase,
      shell: shellStateOf(phase),
      identity,
      session,
      error,
      saveApiUrl,
      startPairing,
      continueAfterApproval,
      resetPairing,
      unlock,
      switchStaff,
      keyStorageWarning,
      roster,
      refreshRoster,
      prepareOffline,
      offlineEligibility,
      signInHeldUntil,
    }),
    [
      phase,
      identity,
      session,
      error,
      saveApiUrl,
      startPairing,
      continueAfterApproval,
      resetPairing,
      unlock,
      switchStaff,
      keyStorageWarning,
      roster,
      refreshRoster,
      prepareOffline,
      offlineEligibility,
      signInHeldUntil,
    ],
  );

  return (
    <DeviceSessionContext.Provider value={value}>{children}</DeviceSessionContext.Provider>
  );
}

function offlineEligibilityMessage(state: OfflineEligibilityStatus["state"]): string {
  if (state === "CATALOG_REQUIRED") {
    return "Offline selling is not ready: reconnect to certify this terminal's catalog.";
  }
  if (state === "LEASE_EXPIRED" || state === "LEASE_NOT_YET_VALID") {
    return "Offline authorization is not valid. Reconnect to Peak.";
  }
  if (state === "DEVICE_REVOKED") return "This register is no longer trusted. Pair it again.";
  if (state === "CLOCK_ROLLBACK") {
    return "Offline access is locked because this terminal's clock changed.";
  }
  if (state === "SHIFT_REQUIRED" || state === "SHIFT_MISMATCH") {
    return "Offline access requires the authorized open shift.";
  }
  if (state === "LIMIT_EXHAUSTED") return "This terminal's offline limit has been reached.";
  if (state === "ELIGIBLE") {
    return "Offline authority verified. Local selling will resume when its transaction workspace is available.";
  }
  return "Offline selling is not authorized on this terminal. Reconnect to Peak.";
}

export function useDeviceSession(): DeviceSessionValue {
  const value = useContext(DeviceSessionContext);
  if (!value) {
    throw new Error("useDeviceSession must be used within DeviceSessionProvider");
  }
  return value;
}

export function useDeviceSessionOptional(): DeviceSessionValue | null {
  return useContext(DeviceSessionContext);
}
