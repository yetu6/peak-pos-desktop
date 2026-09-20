import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { PeakTerminalFixture } from "./visual/PeakTerminalFixture";
import {
  LockedPinFixture,
  LockedRosterFixture,
  NoShiftFixture,
  PairingFixture,
  PairingWaitingFixture,
  SplashFixture,
} from "./visual/JourneyFixtures";
import "@fontsource-variable/geist-mono";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Development-only, deterministic viewport evidence for pre-authentication
// Peak Terminal journeys. Never reachable in a production build
// (`import.meta.env.DEV` gates it).
const VISUAL_FIXTURES = {
  splash: SplashFixture,
  pairing: PairingFixture,
  "pairing-waiting": PairingWaitingFixture,
  "locked-roster": LockedRosterFixture,
  "locked-pin": LockedPinFixture,
  "no-shift": NoShiftFixture,
  terminal: PeakTerminalFixture,
} as const;

function resolveFixture() {
  if (!import.meta.env.DEV) return null;
  const name = import.meta.env.VITE_PEAK_VISUAL_FIXTURE as keyof typeof VISUAL_FIXTURES | undefined;
  return name ? VISUAL_FIXTURES[name] : undefined;
}

const Fixture = resolveFixture();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={350}>{Fixture ? <Fixture /> : <App />}</TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
