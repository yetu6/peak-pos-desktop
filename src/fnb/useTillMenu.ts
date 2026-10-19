import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useOutletId } from "../hooks/usePosData";
import { useRealtimeEvents } from "../realtime/RealtimeProvider";
import { createFnbApi } from "./fnbApi";
import { NO_MENU, type FnbTillMenu } from "./fnbContracts";

/** The events after which the till reads its menu (and its catalogue) again. */
export const MENU_EVENTS: ReadonlySet<string> = new Set(["fnb.menu.updated", "pos.catalog.updated"]);

/**
 * The menu the till last read from Yetu, without asking again: what the
 * offline register knows of groups, tags and sizes while Yetu can't be
 * reached (nothing, after a restart offline).
 */
export function useCachedTillMenu(): FnbTillMenu | undefined {
  const outletId = useOutletId();
  const queryClient = useQueryClient();
  return queryClient.getQueryData<FnbTillMenu>(["fnb", "menu", outletId]);
}

/**
 * The outlet's menu from the Restaurant & Bar module: groups, sizes, what
 * staff say about each item. A Yetu without the module answers 404, which is
 * no menu: the till sells exactly as before. Menu or catalogue news from Yetu
 * (pos.catalog.updated, follow-up 26; fnb.menu.updated) reads both again.
 */
export function useTillMenu() {
  const outletId = useOutletId();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["fnb", "menu", outletId],
    queryFn: async (): Promise<FnbTillMenu> => {
      const { data, error, response } = await createFnbApi().fnbGetTillMenu();
      if (response.status === 404) return NO_MENU;
      if (error) throw new Error(typeof error === "string" ? error : JSON.stringify(error));
      return data ?? NO_MENU;
    },
    retry: false,
  });
  useRealtimeEvents({ kind: "outletOrders", outletId }, (event) => {
    if (!MENU_EVENTS.has(event.type)) return;
    void queryClient.invalidateQueries({ queryKey: ["fnb", "menu", outletId] });
    void queryClient.invalidateQueries({ queryKey: ["pos", "catalog"] });
  });
  // Happy hour (S17c): read the menu again when a rule starts or ends, so the tiles show the price Yetu will charge.
  const changeIn = query.data?.pricesChangeInSeconds ?? 0;
  useEffect(() => {
    if (changeIn <= 0) return;
    const timer = window.setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: ["fnb", "menu", outletId] }),
      (changeIn + 1) * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [changeIn, outletId, queryClient]);
  return query;
}
