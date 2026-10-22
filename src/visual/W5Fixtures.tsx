import { renderPaperText } from "../print/PaperText";
import { useState } from "react";
import { Printer } from "lucide-react";
import { Button, Sheet, Tabs } from "../components/system";
import { paperViews } from "../print/paperPreview";
import { DEFAULT_PRINTER_SETTINGS } from "../print/printerSettings";
import { paperFor } from "../lib/printJobs";
import { readable } from "../print/escpos";
import type { POSPaper, POSPrintJob } from "../lib/posContracts";
import { ORDER } from "./registerData";
import { FIXTURE_PLACE } from "./fixturePlace";
import { FixtureShell } from "./ShellFixtures";

/** Contract-shaped documents from the existing order, rendered through the actual paper builder. */
function PaperFixture({width=48,copy=false,cancel=false}:{width?:32|48;copy?:boolean;cancel?:boolean}){
 const [tab,setTab]=useState("0");
 const context={orderId:ORDER.id,orderNumber:ORDER.orderNumber,dailyNumber:ORDER.dailyNumber,serviceType:ORDER.serviceType,tableLabel:ORDER.tableLabel,waiterName:ORDER.initiatedByName,sentAt:ORDER.createdAt,roundNumber:2,copy,printedAgainAt:ORDER.createdAt,printedAgainByName:ORDER.initiatedByName};
 const papers:POSPaper[]=[{jobType:"KITCHEN_TICKET",document:{...context,station:"BAR",items:[{name:"Bottled water",quantity:2,fulfilment:"PICKED"},{name:"Coffee",quantity:1,fulfilment:"PREPARED"}]}},{jobType:"KITCHEN_TICKET",document:{...context,station:"HOT",items:ORDER.items.map(item=>({...item,fulfilment:"PREPARED"}))}},{jobType:"BILL",document:{...context,kind:"BILL",propertyName:FIXTURE_PLACE.propertyName,outletName:FIXTURE_PLACE.outletName,currency:"TZS",items:ORDER.items,subtotalMinor:ORDER.subtotalMinor,taxMinor:ORDER.taxMinor,totalMinor:ORDER.totalMinor,remainingMinor:ORDER.totalMinor,printedAt:ORDER.createdAt}}];
 const printer={target:{kind:"network" as const,host:"127.0.0.1",port:9100},width};
 const settings={...DEFAULT_PRINTER_SETTINGS,kitchen:printer,receipt:printer};
 const views=paperViews(papers,settings);
 const cancelJob:POSPrintJob={id:"cancel-preview",sourceType:"POS_ORDER",sourceId:ORDER.id,jobType:"KITCHEN_VOID",status:"ON_FILE",attempts:0,createdAt:"",document:{...context,station:"BAR",reason:"Entered by mistake",askedByName:ORDER.initiatedByName,approvedByName:"Manager",voidedAt:ORDER.createdAt,items:[{name:"Bottled water",quantity:1}]}};
 const cancellation=cancel?paperFor(cancelJob,{settings,printRaw:async()=>undefined}):null;
 const text=cancellation?.kind==="thermal"?readable(cancellation.bytes):views[Number(tab)].text;
 return <FixtureShell initialPage="new"><Sheet open onOpenChange={()=>undefined} title={cancel?"Cancel slip":copy?"Print the kitchen ticket again":"Print order"} description={copy?"The last papers again, marked COPY.":"The paper as it will print."} testId="w5-paper-preview" footer={<div className="y-paper-preview__footer"><Button variant="quiet">Back</Button><Button variant="primary" icon={<Printer/>}>Print</Button></div>}>
 {!cancel?<Tabs label="Papers" tabs={views.map((view,index)=>({value:String(index),label:view.name}))} value={tab} onChange={setTab}/>:null}
 <pre className="y-paper" style={{["--paper-chars" as string]:width}} data-testid="paper-text">{renderPaperText(text)}</pre>
 </Sheet></FixtureShell>;
}
export const Papers80Fixture=()=> <PaperFixture/>;
export const Papers58Fixture=()=> <PaperFixture width={32}/>;
export const PapersCopyFixture=()=> <PaperFixture copy/>;
export const PapersCancelFixture=()=> <PaperFixture cancel/>;
