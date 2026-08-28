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
  confirmPairingClaim,
  createStaffSession,
  DeviceNotApprovedError,
  DeviceRevokedError,
  fetchStaffRoster,
  getPairingStatus,
  humanDeviceError,
	issueChallenge,
  rejectPairingClaim,
  requestPairing,
  StaffLoginRejectedError,
  type PairingStatus,
  type RosterEntry,
} from "../lib/deviceAuth";
import { canonicalClaimMessage, generateDeviceKeyPair, signClaimMessage } from "../lib/deviceCrypto";
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
  | "confirming"
  | "locked"
  | "ready";

/**
 * A manager's candidate claim, waiting on this terminal's own signed confirmation. Carries
 * everything [canonicalClaimMessage] needs (ids, not just labels) plus the labels a human
 * reads before deciding.
 */
export interface PendingClaim {
  claimId: string;
  tenantId: string;
  propertyId: string;
  outletId?: string;
  propertyName?: string;
  outletName?: string;
  terminalName: string;
  mode: string;
  nonceB64: string;
  expiresAt?: string;
}

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
  /** Present only during phase "confirming" — the candidate claim a manager submitted,
   *  waiting on this terminal's own decision. */
  claim: PendingClaim | null;
  /** Signs the exact candidate binding with this terminal's own key. Only this can pair. */
  confirmPairing: () => Promise<void>;
  /** Declines a claim this terminal does not recognise; the code rotates. */
  rejectPairing: () => Promise<void>;
  unlock: (staffNumber: string, pin: string) => Promise<void>;
  /** End the waiter ops session. Does not unpair or close the cashier till. */
  switchStaff: (reason?: string) => void;
  /** Present only when Tauri stored the private key as a file. */
  keyStorageWarning: string | null;
  /** Tap-to-select staff for this till's own property. Empty when unavailable — never blocks
   *  PIN entry; manual staff-number entry always remains the fallback. */
  roster: RosterEntry[];
  refreshRoster: () => Promise<void>;
	commission: (terminalId: string, deviceCredential: string, terminalName?: string) => Promise<void>;
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
  applyOpsToken = (token) => usesRealtimeBridge() ? applyOpsTokenToBridge(token, bridgeUrl) : Promise.resolve(),
  skipUrlSetup = Boolean(baseUrl),
}: DeviceSessionProviderProps) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<DevicePhase>("bootstrapping");
  const [identity, setIdentity] = useState<DeviceIdentityRecord | null>(null);
  const [session, setSession] = useState<OperationalSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState<string | null>(baseUrl ?? null);
  const [keyStorageWarning, setKeyStorageWarning] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [claim, setClaim] = useState<PendingClaim | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const claimRef = useRef(claim);
  claimRef.current = claim;

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
		setRoster(await fetchStaffRoster(peakUrl, terminalId, credential));
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
        const keys = await generateDeviceKeyPair();
        record = keys;
        await saveDeviceIdentity(record, store);
      }
      if (cancelled) return;
      await refreshKeyStorageStatus();
      if (cancelled) return;
      setIdentity(record);
		if (record.approved && (record.terminalId || record.deviceCode) && (record.deviceCredential || record.deviceCode)) {
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
  }, [store, clearExpiry, skipUrlSetup, baseUrl, refreshKeyStorageStatus]);

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

  /** Populates [claim] from a "claim_pending_confirmation" status response, or clears it. */
  const applyStatus = useCallback((status: PairingStatus): PendingClaim | null => {
    if (
      status.status !== "claim_pending_confirmation" ||
      !status.claimId ||
      !status.claimTenantId ||
      !status.claimPropertyId ||
      !status.claimTerminalName ||
      !status.claimMode ||
      !status.claimNonce
    ) {
      return null;
    }
    return {
      claimId: status.claimId,
      tenantId: status.claimTenantId,
      propertyId: status.claimPropertyId,
      outletId: status.claimOutletId,
      propertyName: status.claimPropertyName,
      outletName: status.claimOutletName,
      terminalName: status.claimTerminalName,
      mode: status.claimMode,
      nonceB64: status.claimNonce,
      expiresAt: status.claimExpiresAt,
    };
  }, []);

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
      if (status.status === "paired") {
        await markApproved(status);
        return;
      }
      const candidate = applyStatus(status);
      if (candidate) {
        setClaim(candidate);
        setPhase("confirming");
        return;
      }
      setError("Not approved yet. Ask a manager to enter this pairing code.");
    } catch (err) {
      setError(humanDeviceError(err));
    }
  }, [applyStatus, markApproved, peakUrl]);

  const confirmPairing = useCallback(async () => {
    const current = identityRef.current;
    const pending = claimRef.current;
    if (!current || !pending) return;
    setError(null);
    try {
      const message = canonicalClaimMessage({
        pairingRequestId: current.pairing?.pairingRequestId ?? "",
        claimId: pending.claimId,
        nonceB64: pending.nonceB64,
        tenantId: pending.tenantId,
        propertyId: pending.propertyId,
        outletId: pending.outletId,
        terminalName: pending.terminalName,
        mode: pending.mode,
      });
      const signature = await signClaimMessage(current.privateKeyPkcs8, message);
      const result = await confirmPairingClaim(
        peakUrl,
        current.pairing?.pairingRequestId ?? "",
        pending.claimId,
        signature,
      );
      setClaim(null);
      await markApproved({
        deviceCode: result.deviceCode,
        terminalName: pending.terminalName,
        mode: pending.mode,
      });
    } catch (err) {
      setError(humanDeviceError(err));
    }
  }, [markApproved, peakUrl]);

  const rejectPairing = useCallback(async () => {
    const current = identityRef.current;
    const pending = claimRef.current;
    if (!current || !pending) return;
    setError(null);
    try {
      await rejectPairingClaim(peakUrl, current.pairing?.pairingRequestId ?? "", pending.claimId);
    } catch (err) {
      setError(humanDeviceError(err));
    } finally {
      setClaim(null);
      setPhase("waiting");
      await startPairing();
    }
  }, [peakUrl, startPairing]);

  useEffect(() => {
    if (phase !== "waiting" && phase !== "confirming") return;
    let cancelled = false;
    let renewing = false;

    const renew = async () => {
      if (renewing) return;
      renewing = true;
      try {
        setClaim(null);
        setPhase("waiting");
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
      if (phase === "waiting" && Date.parse(pairing.expiresAt) <= Date.now()) {
        await renew();
        return;
      }
      try {
        const status = await getPairingStatus(peakUrl, pairing.pairingRequestId);
        if (cancelled) return;
        if (status.status === "paired") {
          await markApproved(status);
          return;
        }
        const candidate = applyStatus(status);
        if (candidate) {
          setClaim(candidate);
          setPhase("confirming");
          return;
        }
        if (status.status === "pending") {
          // A claim we were showing was rejected or lazily expired server-side and the
          // code rotated — the till learns the new code only by re-registering its key,
          // which the server treats as replacing the same row, not a new identity.
          if (phase === "confirming") await renew();
          return;
        }
        // rejected/expired/abandoned
        await renew();
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
  }, [applyStatus, markApproved, peakUrl, phase, startPairing]);

  const unlock = useCallback(
    async (staffNumber: string, pin: string) => {
      const current = identityRef.current;
		if (!current || !(current.terminalId || current.deviceCode) || !(current.deviceCredential || current.deviceCode)) return;
      clearStaffAuthority();
      setError(null);
      try {
        const next = await createStaffSession({
          baseUrl: peakUrl,
			deviceCode: current.deviceCode,
			terminalId: current.terminalId ?? current.deviceCode,
			deviceCredential: current.deviceCredential ?? current.deviceCode,
          privateKeyPkcs8: current.privateKeyPkcs8,
          staffNumber,
          pin,
          previouslyApproved: current.approved === true,
        });
        await bootstrapOperationalSession(peakUrl, next);
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
        setError(humanDeviceError(err));
      }
    },
    [applyOpsToken, armExpiry, clearStaffAuthority, peakUrl, persist],
  );

	const commission = useCallback(async (terminalId: string, deviceCredential: string, terminalName?: string) => {
		const current = identityRef.current; if (!current) return;
		const challenge = await issueChallenge(peakUrl, terminalId.trim(), deviceCredential.trim());
		if (!challenge) throw new DeviceRevokedError();
		await persist({...current, terminalId: terminalId.trim(), deviceCredential: deviceCredential.trim(), deviceCode: terminalId.trim(), terminalName: terminalName?.trim() || current.terminalName, approved: true, pairing: undefined});
		setPhase("locked"); setError(null);
	}, [peakUrl, persist]);

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
      claim,
      confirmPairing,
      rejectPairing,
      unlock,
      switchStaff,
      keyStorageWarning,
      roster,
      refreshRoster,
		commission,
    }),
    [
      phase,
      identity,
      session,
      error,
      saveApiUrl,
      startPairing,
      continueAfterApproval,
      claim,
      confirmPairing,
      rejectPairing,
      unlock,
      switchStaff,
      keyStorageWarning,
      roster,
      refreshRoster,
		commission,
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
