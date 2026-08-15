import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { QueryClient } from "@tanstack/react-query";
import { RealtimeClient } from "./RealtimeClient";
import type { ConnectionState, RealtimeEnvelope } from "./RealtimeEnvelope";
import {
  queryKeyForEvent,
  type SubscriptionTarget,
} from "./subscriptions";

export interface RealtimeContextValue {
  state: ConnectionState;
  subscribe: (target: SubscriptionTarget) => void;
  unsubscribe: (target: SubscriptionTarget) => void;
  addListener: (listener: (event: RealtimeEnvelope) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export interface RealtimeProviderProps {
  client: RealtimeClient;
  queryClient: QueryClient;
  children: ReactNode;
}

/**
 * Owns the connection lifecycle for the app and turns every delivered event
 * into a TanStack Query invalidation (truthful API-vs-realtime sync: events
 * never replace REST state, they invalidate it).
 */
export function RealtimeProvider({
  client,
  queryClient,
  children,
}: RealtimeProviderProps) {
  const [state, setState] = useState<ConnectionState>(client.connectionState);
  const listeners = useRef(new Set<(event: RealtimeEnvelope) => void>());

  useEffect(() => {
    const handleState = (next: ConnectionState) => setState(next);
    const handleEvent = (event: RealtimeEnvelope) => {
      listeners.current.forEach((listener) => listener(event));
      const keys = queryKeyForEvent(event);
      keys?.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
    };
    const handleResync = () => {
      queryClient.invalidateQueries();
    };
    client.onStateChange = handleState;
    client.onEvent = handleEvent;
    client.onResync = handleResync;
    client.connect();
    return () => {
      client.dispose();
    };
  }, [client, queryClient]);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      state,
      subscribe: (target) => client.subscribe(target),
      unsubscribe: (target) => client.unsubscribe(target),
      addListener: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    }),
    [client, state],
  );

  return (
    <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error("useRealtime must be used within RealtimeProvider");
  return value;
}

/**
 * Registers a subscription for the lifetime of the component and delivers
 * matching events to the handler. Events for a different aggregate are
 * ignored by the caller's filter.
 */
export function useRealtimeEvents(
  target: SubscriptionTarget | null,
  onEvent: (event: RealtimeEnvelope) => void,
  deps: unknown[] = [],
): void {
  const { subscribe, unsubscribe, addListener } = useRealtime();
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!target) return;
    const removeListener = addListener((event) => handlerRef.current(event));
    subscribe(target);
    return () => {
      removeListener();
      unsubscribe(target);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(target), ...deps]);
}