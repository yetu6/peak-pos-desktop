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
import {
  createStaffSession,
  DeviceNotApprovedError,
  getPairingStatus,
  humanDeviceError,
  requestPairing,
  StaffLoginRejectedError,
} from "../lib/deviceAuth";
import { generateDeviceKeyPair } from "../lib/deviceCrypto";
import {
  loadDeviceIdentity,
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
  unlock: (staffNumber: string, pin: string) => Promise<void>;
  /** End the waiter ops session. Does not unpair or close the cashier till. */
  switchStaff: (reason?: string) => void;
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
}

const POLL_MS = 4_000;

export function DeviceSessionProvider({
  children,
  store,
  baseUrl,
  bridgeUrl = REALTIME_BRIDGE_URL,
  applyOpsToken = (token) => applyOpsTokenToBridge(token, bridgeUrl),
  skipUrlSetup = Boolean(baseUrl),
}: DeviceSessionProviderProps) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<DevicePhase>("bootstrapping");
  const [identity, setIdentity] = useState<DeviceIdentityRecord | null>(null);
  const [session, setSession] = useState<OperationalSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState<string | null>(baseUrl ?? null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const peakUrl = baseUrl ?? apiUrl ?? getApiBaseUrl();

  const persist = useCallback(
    async (next: DeviceIdentityRecord) => {
      await saveDeviceIdentity(next, store);
      identityRef.current = next;
      setIdentity(next);
    },
    [store],
  );

  const clearExpiry = useCallback(() => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    expiryTimer.current = null;
  }, []);

  const switchStaff = useCallback(
    (reason?: string) => {
      clearExpiry();
      clearOperationalSession();
      setSession(null);
      // Drop waiter-scoped REST cache and the unsaved cart (New Order unmounts).
      // Do not touch the cashier till id in localStorage and do not unpair.
      queryClient.clear();
      setPhase("locked");
      setError(reason ?? null);
    },
    [clearExpiry, queryClient],
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
        const keys = await generateDeviceKeyPair();
        record = keys;
        await saveDeviceIdentity(record, store);
      }
      if (cancelled) return;
      setIdentity(record);
      if (record.approved && record.deviceCode) {
        setPhase("locked");
        return;
      }
      if (
        record.deviceCode &&
        record.pairing &&
        Date.parse(record.pairing.expiresAt) > Date.now()
      ) {
        setPhase("waiting");
        return;
      }
      setPhase("unpaired");
    })();
    return () => {
      cancelled = true;
      clearExpiry();
    };
  }, [store, clearExpiry, skipUrlSetup, baseUrl]);

  const saveApiUrl = useCallback(
    async (url: string) => {
      setError(null);
      try {
        const saved = await savePeakApiUrl(url);
        setApiUrl(saved);
        let record = identityRef.current ?? (await loadDeviceIdentity(store));
        if (!record) {
          record = await generateDeviceKeyPair();
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
      const issued = await requestPairing(peakUrl, current.publicKeySpki);
      await persist({
        ...current,
        deviceCode: issued.deviceCode,
        approved: false,
        pairing: {
          pairingRequestId: issued.pairingRequestId,
          pairingCode: issued.pairingCode,
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
    async (status: {
      deviceCode?: string;
      terminalName?: string;
      mode?: string;
    }) => {
      const current = identityRef.current;
      if (!current) return;
      await persist({
        ...current,
        deviceCode: status.deviceCode ?? current.deviceCode,
        approved: true,
        pairing: undefined,
        terminalName: status.terminalName ?? current.terminalName,
        mode: status.mode ?? current.mode,
      });
      setPhase("locked");
    },
    [persist],
  );

  const continueAfterApproval = useCallback(async () => {
    const current = identityRef.current;
    const pairingRequestId = current?.pairing?.pairingRequestId;
    if (!pairingRequestId) {
      setError("Not approved yet. Ask a manager to enter this pairing code.");
      return;
    }
    setError(null);
    try {
      const status = await getPairingStatus(peakUrl, pairingRequestId);
      if (status.status === "approved") {
        await markApproved(status);
        return;
      }
      if (status.status === "expired") {
        setError("This code expired. Generate a new one.");
        return;
      }
      if (status.status === "denied") {
        setError("This pairing was denied. Generate a new code.");
        return;
      }
      setError("Not approved yet. Ask a manager to enter this pairing code.");
    } catch (err) {
      setError(humanDeviceError(err));
    }
  }, [markApproved, peakUrl]);

  useEffect(() => {
    if (phase !== "waiting") return;
    let cancelled = false;
    let renewing = false;

    const renew = async () => {
      if (renewing) return;
      renewing = true;
      try {
        await startPairing();
      } finally {
        renewing = false;
      }
    };

    const tick = async () => {
      if (cancelled) return;
      const pairing = identityRef.current?.pairing;
      if (!pairing?.pairingRequestId) {
        await renew();
        return;
      }
      if (Date.parse(pairing.expiresAt) <= Date.now()) {
        await renew();
        return;
      }
      try {
        const status = await getPairingStatus(peakUrl, pairing.pairingRequestId);
        if (cancelled) return;
        if (status.status === "pending") return;
        if (status.status === "approved") {
          await markApproved(status);
          return;
        }
        if (status.status === "expired") {
          await renew();
          return;
        }
        if (status.status === "denied") {
          setError("This pairing was denied. Generate a new code.");
        }
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
  }, [markApproved, peakUrl, phase, startPairing]);

  const unlock = useCallback(
    async (staffNumber: string, pin: string) => {
      const current = identityRef.current;
      if (!current?.deviceCode) return;
      setError(null);
      try {
        const next = await createStaffSession({
          baseUrl: peakUrl,
          deviceCode: current.deviceCode,
          privateKeyPkcs8: current.privateKeyPkcs8,
          staffNumber,
          pin,
        });
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
          mode: next.mode,
          terminalName: next.terminalName,
        });
        armExpiry(next);
        setPhase("ready");
      } catch (err) {
        if (err instanceof DeviceNotApprovedError) {
          setPhase("waiting");
          setError(humanDeviceError(err));
          return;
        }
        if (err instanceof StaffLoginRejectedError || err instanceof SessionExpiredError) {
          setError(humanDeviceError(err));
          return;
        }
        setError(humanDeviceError(err));
      }
    },
    [applyOpsToken, armExpiry, peakUrl, persist],
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
      unlock,
      switchStaff,
    }),
    [
      phase,
      identity,
      session,
      error,
      saveApiUrl,
      startPairing,
      continueAfterApproval,
      unlock,
      switchStaff,
    ],
  );

  return (
    <DeviceSessionContext.Provider value={value}>{children}</DeviceSessionContext.Provider>
  );
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
