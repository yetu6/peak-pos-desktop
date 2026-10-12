import { useRef } from "react";
import { useIdempotencyKey } from "../hooks/usePosData";

/**
 * One idempotency key per request. The caller names the request (what it
 * asks and the version it asks about): asking the same again, after a lost
 * answer, reuses its key, so Yetu does it once; a changed request (a new
 * version after Yetu took the last one) gets a new key. After a refusal the
 * caller forgets the request, so the next press is a new request even if
 * nothing about it changed.
 */
export function useRequestKey(): { keyFor: (request: string) => string; forget: () => void } {
  const fresh = useIdempotencyKey();
  const last = useRef<{ request: string; key: string } | null>(null);
  return {
    keyFor: (request: string): string => {
      if (last.current?.request === request) return last.current.key;
      const key = fresh.next();
      last.current = { request, key };
      return key;
    },
    forget: () => {
      last.current = null;
    },
  };
}
