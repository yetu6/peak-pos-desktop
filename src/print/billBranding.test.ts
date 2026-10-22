import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { prepareBillBranding } from "./billBranding";
import { DEFAULT_PRINTER_SETTINGS } from "./printerSettings";
import { setOperationalSession, clearOperationalSession } from "../lib/operationalSession";
const {read,load,cached}=vi.hoisted(()=>({read:vi.fn(),load:vi.fn(),cached:vi.fn()}));
vi.mock("../lib/posApi",()=>({createPosApi:()=>({businessLogo:read})}));
vi.mock("./billLogo",()=>({loadBillLogo:load,cachedBillLogo:cached}));
const settings={...DEFAULT_PRINTER_SETTINGS,receipt:{target:{kind:"system" as const,name:"Thermal"},width:48 as const,billLogo:true}};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();setOperationalSession({token:"",expiresAt:"",tenantId:"tenant",propertyId:"property",outletId:"outlet",terminalId:"mine",staffId:"staff",assurance:"RESTRICTED"});});
afterEach(clearOperationalSession);
it("logo off never downloads or reads branding",async()=>{expect(await prepareBillBranding({...settings,receipt:{...settings.receipt,billLogo:false}})).not.toHaveProperty("billLogoUrl");expect(read).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();});
it("uses the property checksum as cache identity and retains a fallback for offline printing",async()=>{
 read.mockResolvedValue({data:{logo:{id:"logo",sha256:"hash"},url:"https://files.example/logo?signature=one"}});
 const prepared=await prepareBillBranding(settings);
 expect(prepared.billLogoUrl).toBe("https://branding.yetu.local/property/hash");
 expect(load).toHaveBeenCalledWith("https://files.example/logo?signature=one",48,true,prepared.billLogoUrl);
 read.mockRejectedValue(new Error("Offline"));expect((await prepareBillBranding(settings)).billLogoUrl).toBe(prepared.billLogoUrl);
});
it("removing branding removes the saved reference instead of printing an old logo",async()=>{
 localStorage.setItem("yetu-property-logo:property",JSON.stringify({url:"https://old",identity:"old"}));read.mockResolvedValue({data:{logo:null}});
 expect((await prepareBillBranding(settings)).billLogoUrl).toBeUndefined();expect(localStorage.getItem("yetu-property-logo:property")).toBeNull();expect(load).not.toHaveBeenCalled();
});
