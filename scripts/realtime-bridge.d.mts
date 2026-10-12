/** Types for the dev-only realtime bridge (realtime-bridge.mjs). */
export interface RealtimeBridge {
  port: number;
  close(): Promise<void>;
}

export function startRealtimeBridge(options: {
  backendUrl: string;
  /** 0 picks a free port. */
  port: number;
  opsToken?: string;
  tenantId?: string;
  userId?: string;
  log?: Pick<Console, "log" | "error">;
}): Promise<RealtimeBridge>;
