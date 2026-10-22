import { expect, it } from "vitest";
import { kitchenTicketBytes } from "./kitchenTicket";
import { receiptBytes, textPaperBytes } from "./receipt";
import { voidSlipBytes, formatVoidSlip } from "./voidTicket";
import { readable } from "./escpos";
import { formatKitchenTicket } from "../lib/kitchenTicketPrint";
import { formatReceipt } from "../lib/receiptPrint";
import { formatRefundReceipt, refundReceiptCopyFromPrintDocument } from "../lib/refundReceiptPrint";
const footer="Powered by Yetu-FBC";
it.each([32,48] as const)("all thermal document kinds have one centred footer at %s columns",width=>{
 const documents=[kitchenTicketBytes({lines:[{name:"Rice",quantity:1,options:[]}]},width),receiptBytes({propertyName:"Bahari",lines:[]},width),voidSlipBytes({lines:[{name:"Rice",quantity:1,options:[]}]},width),textPaperBytes("Refund\nPowered by Yetu-FBC\n",width)];
 for(const bytes of documents){const text=readable(bytes);expect(text.trimEnd().endsWith(footer)).toBe(true);expect(text.split(footer)).toHaveLength(2);expect(Array.from(bytes).join(",")).toContain(`27,97,1,27,69,1,${Array.from(new TextEncoder().encode(footer)).join(",")}`);}
});
it("system copies and refund slips share the same footer",()=>{
 const documents=[formatKitchenTicket({lines:[{name:"Rice",quantity:"1"}]}),formatReceipt({lines:[]}),formatVoidSlip({lines:[]}),formatRefundReceipt(refundReceiptCopyFromPrintDocument({lines:[],tenders:[]}))];
 for(const text of documents){expect(text.trimEnd().endsWith(footer)).toBe(true);expect(text.split(footer)).toHaveLength(2);}
});
