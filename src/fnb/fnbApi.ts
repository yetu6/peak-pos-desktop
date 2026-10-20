import { createApiClient, type ApiResult } from "../lib/api";
import type { FnbTillMenu, FnbTillReasons } from "./fnbContracts";

/** The Restaurant & Bar module's routes the till calls (fbc-peak operationIds). */
export function createFnbApi() {
  const client = createApiClient();
  return {
    /** fnbGetTillMenu: how this till arranges its catalogue, its sizes and what staff say about each item. */
    fnbGetTillMenu(): Promise<ApiResult<FnbTillMenu>> {
      return client.GET<FnbTillMenu>("/api/v1/fnb/pos/menu");
    },
    /** fnbGetTillReasons: the reasons this till offers in one tap, as the outlet's managers keep them. */
    fnbGetTillReasons(): Promise<ApiResult<FnbTillReasons>> {
      return client.GET<FnbTillReasons>("/api/v1/fnb/pos/reasons");
    },
  };
}
