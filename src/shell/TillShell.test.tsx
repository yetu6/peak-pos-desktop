import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspacePage } from "../lib/workspace";
import { TillShell, type TillShellProps } from "./TillShell";

beforeEach(() => {
  localStorage.clear();
  document.body.className = "";
});

afterEach(() => {
  localStorage.clear();
  document.body.className = "";
});

type Overrides = Partial<Omit<TillShellProps, "page" | "onNavigate">> & { initialPage?: WorkspacePage };

function Harness({ initialPage = "new", onNavigate, ...props }: Overrides & { onNavigate?: (page: WorkspacePage) => void }) {
  const [page, setPage] = useState<WorkspacePage>(initialPage);
  return (
    <TillShell
      mode="POS"
      tillName="Main Bar"
      person={{ name: "Amina Hassan", initials: "AH" }}
      shiftText="Shift open since 07:02"
      clock="14:32"
      connection={<span data-testid="connectivity">Online</span>}
      onSwitchPerson={vi.fn()}
      onLock={vi.fn()}
      {...props}
      page={page}
      onNavigate={(next) => {
        onNavigate?.(next);
        setPage(next);
      }}
    >
      <p data-testid="current-page">{page}</p>
    </TillShell>
  );
}

function railButtons() {
  return within(screen.getByTestId("terminal-navigation")).getAllByRole("button");
}

describe("TillShell", () => {
  it("shows the till, the person, the shift in words, the connection and the time", () => {
    render(<Harness />);
    expect(screen.getByTestId("pos-register")).toHaveClass("terminal-shell");
    expect(screen.getByTestId("till-label")).toHaveTextContent("Main Bar");
    expect(screen.getByTestId("staff-name")).toHaveTextContent("Amina Hassan");
    expect(screen.getByTestId("shell-business-date")).toHaveTextContent("Shift open since 07:02");
    expect(screen.getByTestId("connectivity")).toHaveTextContent("Online");
    expect(screen.getByTestId("shell-clock")).toHaveTextContent("14:32");
    expect(screen.getByTestId("theme-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-workspace")).toHaveClass("terminal-workspace");
  });

  it("never shows an id or a code when the till has no name", () => {
    render(<Harness tillName={null} />);
    expect(screen.getByTestId("till-label")).toHaveTextContent("This till");
  });

  it("lists the rail in staff words with the key for each, Sell first", () => {
    render(<Harness />);
    const buttons = railButtons();
    expect(buttons.map((button) => button.getAttribute("data-testid"))).toEqual([
      "nav-new",
      "nav-orders",
      "nav-kitchen",
      "nav-manager",
      "nav-status",
    ]);
    expect(buttons.map((button) => button.querySelector(".y-rail__label")?.textContent)).toEqual([
      "Sell",
      "Orders",
      "Kitchen",
      "Cash",
      "Status",
    ]);
    expect(buttons.map((button) => button.querySelector("kbd")?.textContent)).toEqual([
      "F1",
      "F2",
      "F3",
      "F4",
      "F12",
    ]);
    expect(screen.getByTestId("nav-new")).toHaveAttribute("aria-current", "page");
  });

  it("moves to a section when its rail item is pressed", async () => {
    const onNavigate = vi.fn();
    render(<Harness onNavigate={onNavigate} />);
    await userEvent.click(screen.getByTestId("nav-orders"));
    expect(onNavigate).toHaveBeenCalledWith("orders");
    expect(screen.getByTestId("current-page")).toHaveTextContent("orders");
    expect(screen.getByTestId("nav-orders")).toHaveAttribute("aria-current", "page");
  });

  it("keeps a cashier till's own sections and leaves Kitchen out", () => {
    render(<Harness mode="CASHIER" />);
    expect(screen.queryByTestId("nav-kitchen")).not.toBeInTheDocument();
    expect(railButtons()).toHaveLength(4);
  });

  it("working offline keeps closed sections in place and says why instead of moving", async () => {
    const onNavigate = vi.fn();
    render(<Harness offlineCash onNavigate={onNavigate} />);
    expect(screen.getByTestId("shell-offline-cash")).toHaveTextContent("Cash only");
    const orders = screen.getByTestId("nav-orders");
    expect(orders).toHaveAttribute("aria-disabled", "true");
    expect(orders).not.toBeDisabled();
    await userEvent.click(orders);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("current-page")).toHaveTextContent("new");
    expect(screen.getByTestId("rail-reason")).toHaveTextContent(/connection/i);
    expect(orders).toHaveAccessibleDescription(/connection/i);
  });

  it("gives a kitchen display no rail", () => {
    render(<Harness mode="KITCHEN_DISPLAY" initialPage="kitchen" />);
    expect(screen.queryByTestId("terminal-navigation")).not.toBeInTheDocument();
    expect(screen.getByTestId("kds-mode-badge")).toBeInTheDocument();
    expect(screen.getByTestId("pos-register")).toHaveClass("terminal-shell--kds");
    expect(screen.getByTestId("theme-toggle")).toBeInTheDocument();
  });

  it("puts banners under the top bar, before the rail and the work area", () => {
    render(<Harness banners={<div data-testid="test-banner">An update is ready.</div>} />);
    const banner = screen.getByTestId("test-banner");
    const header = screen.getByRole("banner");
    const workspace = screen.getByTestId("terminal-workspace");
    expect(header.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers Switch person and Lock from the person's name", async () => {
    const onSwitchPerson = vi.fn();
    const onLock = vi.fn();
    render(<Harness onSwitchPerson={onSwitchPerson} onLock={onLock} />);
    await userEvent.click(screen.getByTestId("person-menu"));
    expect(screen.getByRole("menuitem", { name: /lock/i })).toHaveTextContent("Ctrl+L");
    await userEvent.click(screen.getByTestId("switch-staff"));
    expect(onSwitchPerson).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("person-menu"));
    await userEvent.click(screen.getByTestId("lock-till"));
    expect(onLock).toHaveBeenCalledTimes(1);
  });
});

describe("TillShell keyboard", () => {
  it("moves between sections with F1 to F4 and F12", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "F2" });
    expect(screen.getByTestId("current-page")).toHaveTextContent("orders");
    fireEvent.keyDown(window, { key: "F4" });
    expect(screen.getByTestId("current-page")).toHaveTextContent("manager");
    fireEvent.keyDown(window, { key: "F12" });
    expect(screen.getByTestId("current-page")).toHaveTextContent("status");
    fireEvent.keyDown(window, { key: "F1" });
    expect(screen.getByTestId("current-page")).toHaveTextContent("new");
  });

  it("works while a field has focus", () => {
    render(<Harness />);
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    fireEvent.keyDown(field, { key: "F2" });
    expect(screen.getByTestId("current-page")).toHaveTextContent("orders");
    field.remove();
  });

  it("ignores the key of a section the till does not have", () => {
    render(<Harness mode="CASHIER" />);
    fireEvent.keyDown(window, { key: "F3" });
    expect(screen.getByTestId("current-page")).toHaveTextContent("new");
  });

  it("explains a closed section instead of opening it", () => {
    render(<Harness offlineCash />);
    fireEvent.keyDown(window, { key: "F2" });
    expect(screen.getByTestId("current-page")).toHaveTextContent("new");
    expect(screen.getByTestId("rail-reason")).toHaveTextContent(/connection/i);
  });

  it("leaves an open dialog (a payment, a void) in place: section keys wait, Ctrl+L still locks", () => {
    const onLock = vi.fn();
    render(
      <>
        <Harness onLock={onLock} />
        <div role="dialog" data-state="open" aria-label="Take payment" />
      </>,
    );
    fireEvent.keyDown(window, { key: "F2" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("current-page")).toHaveTextContent("new");
    expect(screen.queryByRole("combobox", { name: /search/i })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("locks with Ctrl+L", () => {
    const onLock = vi.fn();
    render(<Harness onLock={onLock} />);
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("opens a command search with Ctrl+K that finds sections by what people call the job", async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const search = await screen.findByRole("combobox", { name: /search/i });
    await userEvent.type(search, "close shift");
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Cash");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByTestId("current-page")).toHaveTextContent("manager");
    expect(screen.queryByRole("combobox", { name: /search/i })).not.toBeInTheDocument();
  });

  it("finds the theme switch and lock in the command search", async () => {
    const onLock = vi.fn();
    render(<Harness onLock={onLock} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const search = await screen.findByRole("combobox", { name: /search/i });
    await userEvent.type(search, "dark");
    await userEvent.keyboard("{Enter}");
    expect(document.body).toHaveClass("dark-theme");
    expect(localStorage.getItem("yetu-till-theme")).toBe("dark");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await userEvent.type(await screen.findByRole("combobox", { name: /search/i }), "lock");
    await userEvent.keyboard("{Enter}");
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("closes the command search with Esc", async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByRole("combobox", { name: /search/i });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: /search/i })).not.toBeInTheDocument();
  });
});
