import { beforeEach, expect, it } from "vitest";
import { cacheOutletOrderSettings, cachedOutletOrderSettings } from "./outletOrderSettings";
beforeEach(() => localStorage.clear());
it("keeps prompt preferences scoped to property and outlet without granting authority", () => {
 cacheOutletOrderSettings("p1", "o1", {askForTable:false,captureGuestCount:true});
 expect(cachedOutletOrderSettings("p1","o1")).toEqual({askForTable:false,captureGuestCount:true});
 expect(cachedOutletOrderSettings("p2","o1")).toEqual({askForTable:true,captureGuestCount:false});
 expect(cachedOutletOrderSettings("p1","o2")).toEqual({askForTable:true,captureGuestCount:false});
});
it("ignores malformed preferences and storage", () => {
 cacheOutletOrderSettings("p1","o1",{askForTable:"false",captureGuestCount:1});
 expect(cachedOutletOrderSettings("p1","o1")).toEqual({askForTable:true,captureGuestCount:false});
 localStorage.setItem("yetu-outlet-order:p1:o1", "{");
 expect(cachedOutletOrderSettings("p1","o1")).toEqual({askForTable:true,captureGuestCount:false});
});
