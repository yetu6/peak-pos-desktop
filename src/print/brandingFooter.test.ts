import { expect, it } from "vitest";
import { kitchenTicketBytes } from "./kitchenTicket";
import { receiptBytes, textPaperBytes } from "./receipt";
import { voidSlipBytes, formatVoidSlip } from "./voidTicket";
import { readable } from "./escpos";
import { formatKitchenTicket } from "../lib/kitchenTicketPrint";
import { formatReceipt } from "../lib/receiptPrint";
import { formatRefundReceipt, refundReceiptCopyFromPrintDocument } from "../lib/refundReceiptPrint";
const brand="Powered by Yetu";
const address="yetu.fbcsoftwares.com";
const bytesOf=(text:string)=>Array.from(new TextEncoder().encode(text)).join(",");
const lastTwoLines=(text:string)=>text.trimEnd().split("\n").slice(-2).map(line=>line.trim());
it.each([32,48] as const)("all thermal document kinds end with one centred two-line footer at %s columns",width=>{
 const documents=[kitchenTicketBytes({lines:[{name:"Rice",quantity:1,options:[]}]},width),receiptBytes({propertyName:"Bahari",lines:[]},width),voidSlipBytes({lines:[{name:"Rice",quantity:1,options:[]}]},width),textPaperBytes(`Refund\n${brand}\n${address}\n`,width)];
 for(const bytes of documents){const text=readable(bytes);expect(lastTwoLines(text)).toEqual([brand,address]);expect(text.split(brand)).toHaveLength(2);expect(text.split(address)).toHaveLength(2);expect(Array.from(bytes).join(",")).toContain(`27,97,1,27,69,1,${bytesOf(brand)},10,27,69,0,${bytesOf(address)},10`);}
});
it("system copies and refund slips share the same footer",()=>{
 const documents=[formatKitchenTicket({lines:[{name:"Rice",quantity:"1"}]}),formatReceipt({lines:[]}),formatVoidSlip({lines:[]}),formatRefundReceipt(refundReceiptCopyFromPrintDocument({lines:[],tenders:[]}))];
 for(const text of documents){expect(lastTwoLines(text)).toEqual([brand,address]);expect(text.split(brand)).toHaveLength(2);expect(text.split(address)).toHaveLength(2);}
});
