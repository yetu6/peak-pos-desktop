import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { POSPrintJob } from "../lib/posContracts";
import { PrintQueueCard } from "./PrintQueueCard";
const { list, retry, native, printed, notPrinted } = vi.hoisted(()=>({list:vi.fn(),retry:vi.fn(),native:{uses:vi.fn(),inspect:vi.fn()},printed:vi.fn(),notPrinted:vi.fn()}));
vi.mock("../lib/printJobs",()=>({listPrintJobs:list}));
vi.mock("./printFor",()=>({retryPrintJob:retry}));
vi.mock("./nativePrintJournal",()=>({usesNativePrintJournal:native.uses,inspectNativePrint:native.inspect}));
vi.mock("./printResolution",()=>({confirmPaperPrinted:printed,confirmPaperNotPrinted:notPrinted}));
const paper:POSPrintJob={id:"paper-7",sourceType:"POS_ORDER",sourceId:"order-7",jobType:"KITCHEN_TICKET",status:"FAILED",attempts:1,createdAt:"",document:{dailyNumber:7,station:"BAR"},lastError:"Printer is off"};
beforeEach(()=>{vi.clearAllMocks();list.mockResolvedValue([paper]);retry.mockResolvedValue({ok:true});native.uses.mockReturnValue(false);printed.mockResolvedValue(undefined);notPrinted.mockResolvedValue(undefined);});
it("keeps failed papers visible and retries the existing job",async()=>{
 render(<PrintQueueCard/>);
 expect(await screen.findByText("Order 7 · Bar")).toBeVisible();
 expect(screen.getByText("Not printed")).toBeVisible();
 expect(screen.getByText("Printer is off")).toBeVisible();
 list.mockResolvedValue([]);
 await userEvent.click(screen.getByRole("button",{name:"Print again"}));
 expect(retry).toHaveBeenCalledWith(paper);
 await waitFor(()=>expect(screen.queryByText("Order 7 · Bar")).not.toBeInTheDocument());
});
it("a claimed paper asks for confirmation recovery, never a new copy",async()=>{
 list.mockResolvedValue([{...paper,status:"CLAIMED"}]);
 render(<PrintQueueCard/>);
 await userEvent.click(await screen.findByRole("button",{name:"Check printing"}));
 expect(retry).toHaveBeenCalledWith(expect.objectContaining({id:paper.id,status:"CLAIMED"}));
 expect(screen.queryByRole("button",{name:"Print again"})).not.toBeInTheDocument();
});
it("never offers printing for stored paid bills or completed jobs",async()=>{
 list.mockResolvedValue([{...paper,status:"ON_FILE"},{...paper,id:"printed",status:"PRINTED"}]);
 render(<PrintQueueCard/>);
 expect(await screen.findByText("No papers waiting.")).toBeVisible();
 expect(screen.queryByRole("button",{name:"Print again"})).not.toBeInTheDocument();
 expect(retry).not.toHaveBeenCalled();
});
it("keeps an unresolved printer error visible after retry",async()=>{
 retry.mockResolvedValue({ok:false,error:"Check the printer before making a copy."});
 render(<PrintQueueCard/>);
 await userEvent.click(await screen.findByRole("button",{name:"Print again"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("Check the printer before making a copy.");
 expect(screen.getByText("Order 7 · Bar")).toBeVisible();
});
it("an uncertain paper can be answered either way: printed, or not printed so it can print again as itself",async()=>{
 native.uses.mockReturnValue(true);native.inspect.mockResolvedValue({state:"unknown",attempt:1});
 list.mockResolvedValue([{...paper,status:"CLAIMED"}]);
 render(<PrintQueueCard/>);
 await userEvent.click(await screen.findByRole("button",{name:"Check printing"}));
 expect(await screen.findByRole("button",{name:"I checked: the paper printed"})).toBeVisible();
 await userEvent.click(screen.getByRole("button",{name:"It did not print"}));
 expect(notPrinted).toHaveBeenCalledWith(expect.objectContaining({id:paper.id,status:"CLAIMED"}));
 expect(printed).not.toHaveBeenCalled();
 expect(screen.queryByRole("button",{name:"It did not print"})).not.toBeInTheDocument();
});
