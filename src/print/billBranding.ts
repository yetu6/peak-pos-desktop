import { createPosApi } from "../lib/posApi";
import { getOperationalSession } from "../lib/operationalSession";
import { cachedBillLogo, loadBillLogo } from "./billLogo";
import type { PrinterSettings } from "./printerSettings";

/** Advisory branding cache, isolated by property. It never authorizes a print or changes money. */
export async function prepareBillBranding(settings: PrinterSettings): Promise<PrinterSettings> {
 const printer=settings.receipt;const session=getOperationalSession();
 if(!printer?.billLogo||!session)return settings;
 const key=`yetu-property-logo:${session.propertyId}`;
 let saved:{url:string;identity:string}|undefined;
 try { const raw=localStorage.getItem(key);if(raw){const value=JSON.parse(raw);if(typeof value.url==="string"&&typeof value.identity==="string")saved=value;} }catch{ /* Branding failure keeps the text bill. */ }
 try {
  const response=await createPosApi().businessLogo();
  if(!response.error&&response.data){
   const {logo,url}=response.data;
   if(!logo){try{localStorage.removeItem(key);}catch{/* optional cache */}return {...settings,billLogoUrl:undefined};}
   if(url){saved={url,identity:`https://branding.yetu.local/${session.propertyId}/${logo.sha256}`};try{localStorage.setItem(key,JSON.stringify(saved));}catch{/* optional cache */}}
  }
 }catch{/* Cached branding or the text name still prints. */}
 if(!saved)return {...settings,billLogoUrl:undefined};
 if(!cachedBillLogo(saved.identity,printer.width)) await loadBillLogo(saved.url,printer.width,true,saved.identity);
 return {...settings,billLogoUrl:saved.identity};
}
