import { useRef } from "react";
import { useIdempotencyKey } from "../hooks/usePosData";

/**
 * One idempotency key per request. The caller names the request (what it
 * asks and the version it asks about): asking the same again, after a lost
 * answer, reuses its key, so Yetu does it once; a changed request (a new
 * version after Yetu took the last one) gets a new key.
 */
export function useRequestKey(): (request: string) => string {
  const fresh = useIdempotencyKey();
  const last = useRef<{ request: string; key: string } | null>(null);
  return (request: string): string => {
    if (last.current?.request === request) return last.current.key;
    const key = fresh.next();
    last.current = { request, key };
    return key;
  };
}
