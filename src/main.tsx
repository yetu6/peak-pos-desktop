import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { startDisplaySize } from "./lib/displaySize";
import { bootTheme } from "./lib/theme";
import "./index.css";

// The stored per-device theme (or the before-pairing default) is on screen
// before the first paint; the paired mode's default follows once it is known.
bootTheme();
// The saved display size (or Automatic, fitting the window) before the first screen.
startDisplaySize();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Development-only, deterministic viewport evidence: a fixture named by
// `?fixture=` (the pixel harness) or `VITE_PEAK_VISUAL_FIXTURE`. The import is
// inside the DEV branch, so a production build carries no fixture at all.
async function resolveFixture(): Promise<React.ComponentType | null> {
  if (!import.meta.env.DEV) return null;
  const name =
    new URLSearchParams(window.location.search).get("fixture") ??
    (import.meta.env.VITE_PEAK_VISUAL_FIXTURE as string | undefined);
  if (!name) return null;
  const { resolveVisualFixture } = await import("./visual/fixtures");
  return resolveVisualFixture(name);
}

void resolveFixture().then((Fixture) => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={350}>{Fixture ? <Fixture /> : <App />}</TooltipProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
});
