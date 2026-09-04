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
import { applyOpsTokenToBridge } from "../lib/applyOpsToken";
import { usesRealtimeBridge } from "../lib/peakSocket";
import {
  createStaffSession,
  deviceCredentialDigest,
  DeviceNotApprovedError,
  DeviceRevokedError,
  fetchStaffRoster,
  generateDeviceCredential,
  getPairingStatus,
  humanDeviceError,
  isDeviceNetworkFailure,
  requestPairing,
  StaffLoginRejectedError,
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
  SessionExpiredError,
  setOperationalSession,
  type OperationalSession,
} from "../lib/operationalSession";
import { bootstrapOperationalSession } from "../lib/postLoginBootstrap";
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
  unlock: (staffNumber: string, pin: string) => Promise<void>;
  /** End the waiter ops session. Does not unpair or close the cashier till. */
  switchStaff: (reason?: string) => void;
  /** Present when the OS secure-store boundary cannot provide hardware-backed storage. */
  keyStorageWarning: string | null;
  /** Tap-to-select staff for this till's own property. Empty when unavailable — never blocks
   *  PIN entry; manual staff-number entry always remains the fallback. */
  roster: RosterEntry[];
  refreshRoster: () => Promise<void>;
  offlineEligibility: OfflineEligibilityStatus | null;
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
  /** Idle minutes before PIN lock. Peak `expiresAt` still locks independently. */
  idleLockMinutes?: number;
  deviceAuthority?: DeviceAuthority;
  offlineAuthority?: OfflineAuthority;
  localPosCore?: LocalPosCore;
}

const POLL_MS = 4_000;

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

  const refreshRoster = useCallback(async () => {
    const current = identityRef.current;
    if (!current?.deviceCode) {
      setRoster([]);
      return;
    }
		const terminalId = current.terminalId ?? current.deviceCode;
		const credential = current.deviceCredential ?? current.deviceCode;
		if (!terminalId || !credential) { setRoster([]); return; }
    const online=await fetchStaffRoster(peakUrl,terminalId,credential);
    if(online.length>0){setRoster(online);return}
    const local=await offlineAuthorityRef.current?.staffRoster?.().catch(()=>[]);
    setRoster((local??[]).map(entry=>({fullName:entry.displayName,staffNumber:entry.staffId})));
  }, [peakUrl]);

  useEffect(() => {
    if (phase !== "locked") return;
    void refreshRoster();
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
        },
      });
      setPhase("waiting");
    } catch (err) {
      setError(humanDeviceError(err));
    }
  }, [peakUrl, persist]);

  const markApproved = useCallback(
    async (terminalId: string, binding?: TerminalBinding) => {
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
        await markApproved(status.terminalId, status.offlineAuthority);
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
    };

    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [continueAfterApproval, phase, resetPairing]);

  const unlock = useCallback(
    async (staffNumber: string, pin: string) => {
      const current = identityRef.current;
		if (!current || !(current.terminalId || current.deviceCode) || !(current.deviceCredential || current.deviceCode)) return;
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
          previouslyApproved: current.approved === true,
        });
        if (!store) {
          offlineAuthorityRef.current ??= await loadNativeOfflineAuthority();
          localPosCoreRef.current ??= await loadLocalPosCore();
        }
        await bootstrapOperationalSession(peakUrl, next, {
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
        if (offlineAuthorityRef.current) {
          await offlineAuthorityRef.current.authenticateStaff(next.staffId, pin);
          setOfflineEligibility(
            await offlineAuthorityRef.current.eligibilityStatus(next.staffId),
          );
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
          terminalName: next.terminalName ?? current.terminalName,
        });
        armExpiry(next);
        setPhase("ready");
      } catch (err) {
        clearStaffAuthority();
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
        if (err instanceof StaffLoginRejectedError || err instanceof SessionExpiredError) {
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
    [applyOpsToken, armExpiry, clearStaffAuthority, peakUrl, persist],
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
      offlineEligibility,
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
      offlineEligibility,
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
