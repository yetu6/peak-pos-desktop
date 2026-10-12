import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NoteSheet } from "./NoteSheet";

describe("NoteSheet", () => {
  it("takes a note for the order before it starts", async () => {
    const onSave = vi.fn();
    render(<NoteSheet note="" locked={false} onSave={onSave} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Order note" }), "No chilli for table 4");
    await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(onSave).toHaveBeenCalledWith("No chilli for table 4");
  });

  it("once the order has started, shows the note it was saved with and says it can't change", () => {
    render(<NoteSheet note="No chilli" locked onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("No chilli")).toBeInTheDocument();
    expect(screen.getByText("Yetu keeps the note the order started with. It can't be changed now.")).toBeInTheDocument();
  });
});
