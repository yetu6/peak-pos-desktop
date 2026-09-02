import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { PeakTerminalFixture } from "./visual/PeakTerminalFixture";
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

const visualFixture = import.meta.env.DEV && import.meta.env.VITE_PEAK_VISUAL_FIXTURE === "terminal";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={350}>
        {visualFixture ? <PeakTerminalFixture /> : <App />}
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
