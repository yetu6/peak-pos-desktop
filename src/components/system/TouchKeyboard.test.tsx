import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "./containers";
import { Field, SearchField } from "./fields";
import { KEYBOARD_HEIGHT_FALLBACK, TouchKeyboardProvider } from "./TouchKeyboard";
import { resetKeyboardSession, setKeyboardMode } from "../../lib/onScreenKeyboard";

function Form() {
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [limited, setLimited] = useState("");
  return (
    <TouchKeyboardProvider>
      <Field label="Reason" value={reason} onChange={setReason} data-testid="reason" />
      <SearchField label="Find" value={search} onChange={setSearch} placeholder="Search" data-testid="search" />
      <Field label="Code" value={limited} onChange={setLimited} maxLength={3} data-testid="code" />
      <output data-testid="state">{`${reason}|${search}|${limited}`}</output>
    </TouchKeyboardProvider>
  );
}

const focus = (id: string) => act(async () => void (id === "search" ? screen.getByLabelText("Find") : screen.getByTestId(id)).focus());
const tap = (name: string) => userEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  window.localStorage.clear();
  resetKeyboardSession();
  setKeyboardMode("always");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
});
afterEach(() => {
  setKeyboardMode("auto");
  resetKeyboardSession();
});

describe("On-screen keyboard", () => {
  it("fills a reason box and a search box by tapping keys alone", async () => {
    render(<Form />);
    // The boxes are focused by a tap only: no keyboard events anywhere below.
    await focus("reason");
    const group = await screen.findByRole("group", { name: "On-screen keyboard" });
    expect(group).toBeInTheDocument();
    await tap("Shift");
    await tap("T");
    await tap("o");
    await tap("Space");
    await tap("4");
    await tap("Dash");
    await tap("Backspace");
    await tap("5");
    expect(screen.getByTestId("reason")).toHaveValue("To 45");
    expect(screen.getByTestId("reason")).toHaveFocus();

    await focus("search");
    await tap("b");
    await tap("a");
    await tap("r");
    expect(screen.getByLabelText("Find")).toHaveValue("bar");
    expect(screen.getByTestId("state")).toHaveTextContent("To 45|bar|");
  });

  it("keeps maxLength", async () => {
    render(<Form />);
    await focus("code");
    for (const key of ["a", "b", "c", "d"]) await tap(key);
    expect(screen.getByTestId("code")).toHaveValue("abc");
  });

  it("hides on Done, on Escape and when the box loses focus", async () => {
    render(<Form />);
    await focus("reason");
    await tap("Done");
    expect(screen.queryByRole("group", { name: "On-screen keyboard" })).toBeNull();
    await focus("reason");
    expect(await screen.findByRole("group", { name: "On-screen keyboard" })).toBeInTheDocument();
    await act(async () => void screen.getByTestId("reason").blur());
    expect(screen.queryByRole("group", { name: "On-screen keyboard" })).toBeNull();
  });

  it("Off never shows it", async () => {
    setKeyboardMode("off");
    render(<Form />);
    await focus("reason");
    expect(screen.queryByRole("group", { name: "On-screen keyboard" })).toBeNull();
  });

  it("Automatic shows on touch, and a physical key press hides it", async () => {
    setKeyboardMode("auto");
    render(<Form />);
    await focus("reason");
    // No touch seen yet (a mouse and keyboard computer): nothing shows.
    expect(screen.queryByRole("group", { name: "On-screen keyboard" })).toBeNull();
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
    });
    expect(await screen.findByRole("group", { name: "On-screen keyboard" })).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    expect(screen.queryByRole("group", { name: "On-screen keyboard" })).toBeNull();
  });

  it("keeps the focused box clear of the keyboard at 1024x768", async () => {
    render(<Form />);
    const reason = screen.getByTestId("reason");
    // A box low on the screen: its bottom edge at 700px of 768.
    reason.getBoundingClientRect = () => ({ top: 650, bottom: 700, left: 100, right: 500, width: 400, height: 50, x: 100, y: 650, toJSON: () => ({}) });
    await focus("reason");
    const root = await screen.findByTestId("touch-keyboard");
    expect(root).toBeInTheDocument();
    const lift = Number(document.querySelector("[data-keyboard-lift]")?.getAttribute("data-keyboard-lift"));
    expect(700 - lift).toBeLessThanOrEqual(768 - KEYBOARD_HEIGHT_FALLBACK);
    expect(lift).toBeGreaterThan(0);
  });

  it("tapping keys does not close the sheet the box is in", async () => {
    const onOpenChange = vi.fn();
    function InSheet() {
      const [value, setValue] = useState("");
      return (
        <TouchKeyboardProvider>
          <Sheet open onOpenChange={onOpenChange} title="Note" description="x">
            <Field label="Note" value={value} onChange={setValue} data-testid="note" />
          </Sheet>
        </TouchKeyboardProvider>
      );
    }
    render(<InSheet />);
    await focus("note");
    await tap("h");
    await tap("i");
    expect(screen.getByTestId("note")).toHaveValue("hi");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
