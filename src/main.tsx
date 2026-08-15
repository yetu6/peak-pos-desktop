import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RealtimeClient } from "./realtime/RealtimeClient";
import { RealtimeProvider } from "./realtime/RealtimeProvider";
import { App } from "./App";
import { REALTIME_BRIDGE_URL } from "./lib/env";
import {
  createRealtimeBackfill,
  createRealtimeCursorStorage,
} from "./lib/realtimeBackfill";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

const realtimeClient = new RealtimeClient({
  createSocket: () => new WebSocket(REALTIME_BRIDGE_URL),
  backfillEvents: createRealtimeBackfill().fetchEvents,
  cursorStorage: createRealtimeCursorStorage(),
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider client={realtimeClient} queryClient={queryClient}>
        <App />
      </RealtimeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);