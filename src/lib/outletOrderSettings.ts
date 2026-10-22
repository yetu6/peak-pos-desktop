export interface OutletOrderSettings { askForTable: boolean; captureGuestCount: boolean }
export const DEFAULT_OUTLET_ORDER: OutletOrderSettings = {askForTable:true,captureGuestCount:false};
const key = (property:string, outlet:string) => `yetu-outlet-order:${property}:${outlet}`;
export function orderSettingsFrom(raw:unknown):OutletOrderSettings {
 const value=raw && typeof raw === "object" ? raw as Partial<OutletOrderSettings> : {};
 return {askForTable:typeof value.askForTable === "boolean" ? value.askForTable : true,captureGuestCount:typeof value.captureGuestCount === "boolean" ? value.captureGuestCount : false};
}
/** Prompts only: no permissions, prices or financial state are cached here. */
export function cachedOutletOrderSettings(property:string|null,outlet:string|null):OutletOrderSettings {
 if(!property||!outlet)return DEFAULT_OUTLET_ORDER;
 try{return orderSettingsFrom(JSON.parse(localStorage.getItem(key(property,outlet))??"null"));}catch{return DEFAULT_OUTLET_ORDER;}
}
export function cacheOutletOrderSettings(property:string|null,outlet:string|null,raw:unknown):void {
 if(!property||!outlet)return;
 try{localStorage.setItem(key(property,outlet),JSON.stringify(orderSettingsFrom(raw)));}catch{/* Online preferences still apply when local storage is unavailable. */}
}
