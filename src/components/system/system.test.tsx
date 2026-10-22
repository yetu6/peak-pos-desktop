import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PIN_LENGTH } from "../../access/accessSettings";
import {
  Banner,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  KeyHint,
  Keypad,
  ListRow,
  Money,
  MoneyField,
  PermissionNotice,
  QuickCash,
  SearchField,
  SegmentedControl,
  Sheet,
  Skeleton,
  StatusChip,
  Stepper,
  SupervisorApproval,
  SupervisorApprovalActions,
  Tabs,
  TicketLine,
  Tile,
  Toast,
  type SupervisorApprovalProps,
} from "./index";

describe("Button and IconButton", () => {
  it("draws the four kinds at the three touch sizes", () => {
    render(
      <>
        <Button variant="pay" size={64}>Pay TSh 42,500</Button>
        <Button variant="secondary" size={56}>Send to kitchen</Button>
        <Button variant="quiet">More</Button>
        <Button variant="danger">Cancel order</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Pay TSh 42,500" })).toHaveClass("y-button--pay", "y-button--64");
    expect(screen.getByRole("button", { name: "Send to kitchen" })).toHaveClass("y-button--secondary", "y-button--56");
    expect(screen.getByRole("button", { name: "More" })).toHaveClass("y-button--quiet", "y-button--48");
    expect(screen.getByRole("button", { name: "Cancel order" })).toHaveClass("y-button--danger");
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute("type", "button");
  });

  it("shows the shortcut beside the words when it has one", () => {
    render(<Button keyHint="F9">Pay</Button>);
    expect(screen.getByRole("button", { name: /Pay/ }).querySelector("kbd")).toHaveTextContent("F9");
  });

  it("always gives an icon button a name", () => {
    render(<IconButton label="Add a note" icon={<Plus />} />);
    const button = screen.getByRole("button", { name: "Add a note" });
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("choices", () => {
  it("SegmentedControl is one choice from a few, moved with the arrow keys", async () => {
    function Example() {
      const [value, setValue] = useState("DINE_IN");
      return (
        <SegmentedControl
          label="Order type"
          value={value}
          onChange={setValue}
          options={[
            { value: "DINE_IN", label: "Dine in" },
            { value: "TAKEAWAY", label: "Takeaway" },
            { value: "ROOM_SERVICE", label: "Room service" },
          ]}
        />
      );
    }
    render(<Example />);
    const group = screen.getByRole("radiogroup", { name: "Order type" });
    expect(within(group).getByRole("radio", { name: "Dine in" })).toBeChecked();
    within(group).getByRole("radio", { name: "Dine in" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(within(group).getByRole("radio", { name: "Takeaway" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Takeaway" })).toHaveFocus();
  });

  it("Tabs marks the open tab and shows counts as numbers", async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Orders"
        value="open"
        onChange={onChange}
        tabs={[
          { value: "open", label: "Open", count: 4 },
          { value: "paid", label: "Paid today", count: 12 },
        ]}
      />,
    );
    expect(screen.getByRole("tab", { name: /Open/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Paid today/ })).toHaveTextContent("12");
    await userEvent.click(screen.getByRole("tab", { name: /Paid today/ }));
    expect(onChange).toHaveBeenCalledWith("paid");
  });

  it("Stepper changes a quantity within its limits and names what it changes", async () => {
    const onChange = vi.fn();
    render(<Stepper label="Cappuccino" value={1} min={1} max={3} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "One fewer Cappuccino" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "One more Cappuccino" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});

describe("fields", () => {
  it("SearchField has a label and a clear button", async () => {
    const onChange = vi.fn();
    render(<SearchField label="Search the menu" value="tart" onChange={onChange} />);
    expect(screen.getByRole("searchbox", { name: "Search the menu" })).toHaveValue("tart");
    await userEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("Field ties its hint and its error to the input", () => {
    render(<Field label="Table" hint="As written on the table" error="Add a table" value="" onChange={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Table" });
    expect(input).toHaveAccessibleDescription(/As written on the table/);
    expect(input).toHaveAccessibleDescription(/Add a table/);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("MoneyField takes an amount in shillings and hands back minor units", async () => {
    const onValueChange = vi.fn();
    function Example() {
      const [value, setValue] = useState("");
      return (
        <MoneyField
          label="Cash received"
          currency="TZS"
          value={value}
          onValueChange={(text, minor) => {
            setValue(text);
            onValueChange(text, minor);
          }}
        />
      );
    }
    render(<Example />);
    const input = screen.getByRole("textbox", { name: "Cash received" });
    expect(screen.getByText("TSh")).toBeInTheDocument();
    await userEvent.type(input, "42500");
    expect(onValueChange).toHaveBeenLastCalledWith("42500", 4_250_000);
  });
});

describe("Keypad and QuickCash", () => {
  it("lays out the keypad like a phone, 1-2-3 on top", () => {
    render(<Keypad label="Amount" onKey={vi.fn()} />);
    const keys = within(screen.getByRole("group", { name: "Amount" })).getAllByRole("button");
    expect(keys.map((key) => key.getAttribute("aria-label") ?? key.textContent)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "Delete the last digit",
    ]);
  });

  it("a PIN keypad offers Clear instead of 00 and reports each key", async () => {
    const onKey = vi.fn();
    render(<Keypad label="PIN" variant="pin" onKey={onKey} />);
    await userEvent.click(screen.getByRole("button", { name: "7" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete the last digit" }));
    expect(onKey.mock.calls.map(([key]) => key)).toEqual(["7", "clear", "delete"]);
  });

  it("QuickCash offers Exact and the next likely notes", async () => {
    const onPick = vi.fn();
    render(<QuickCash dueMinor={4_250_000} currency="TZS" onPick={onPick} />);
    const buttons = within(screen.getByRole("group", { name: "Quick cash" })).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "ExactTSh 42,500",
      "TSh 44,000",
      "TSh 45,000",
      "TSh 50,000",
    ]);
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[3]);
    expect(onPick.mock.calls.map(([minor]) => minor)).toEqual([4_250_000, 5_000_000]);
  });
});

describe("display", () => {
  it("Money writes the amount once, in tabular figures", () => {
    render(<Money minor={4_250_000} currency="TZS" size="figure" data-testid="total" />);
    expect(screen.getByTestId("total")).toHaveTextContent("TSh 42,500");
    expect(screen.getByTestId("total")).toHaveClass("y-money", "y-money--figure");
  });

  it("StatusChip always carries a word and an icon, never colour alone", () => {
    render(<StatusChip tone="success">Ready</StatusChip>);
    const chip = screen.getByText("Ready").closest(".y-chip");
    expect(chip).toHaveClass("y-chip--success");
    expect(chip?.querySelector("svg")).not.toBeNull();
  });

  it("Tile shows the name and price, and a sold out item stays in place with the word", () => {
    render(
      <>
        <Tile name="Chocolate tart" price="TSh 9,500" onClick={vi.fn()} />
        <Tile name="Grilled fish" price="TSh 25,000" soldOut onClick={vi.fn()} />
      </>,
    );
    expect(screen.getByRole("button", { name: /Chocolate tart/ })).toHaveTextContent("TSh 9,500");
    const soldOut = screen.getByRole("button", { name: /Grilled fish/ });
    expect(soldOut).toHaveTextContent("Sold out");
    expect(soldOut).toHaveAttribute("aria-disabled", "true");
  });

  it("TicketLine shows the quantity, the options under the name, and the price", () => {
    render(
      <TicketLine quantity={2} name="Cappuccino" options={["Oat milk"]} amount="TSh 15,000" selected onSelect={vi.fn()} />,
    );
    const line = screen.getByRole("button", { name: /2 × Cappuccino/ });
    expect(line).toHaveAttribute("aria-pressed", "true");
    expect(within(line).getByText("2")).toHaveClass("y-ticket-line__qty");
    expect(within(line).getByText("Oat milk")).toBeInTheDocument();
    expect(within(line).getByText("TSh 15,000")).toBeInTheDocument();
  });

  it("ListRow is a button when it can be opened", async () => {
    const onClick = vi.fn();
    render(<ListRow title="Order 0142" meta="Table 12 · 14:05" trailing="TSh 42,500" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: /Order 0142/ }));
    expect(onClick).toHaveBeenCalled();
  });

  it("KeyHint shows the keys to press", () => {
    render(<KeyHint keys="Ctrl+K" />);
    expect(screen.getByText("Ctrl+K").tagName).toBe("KBD");
  });

  it("Skeleton is hidden from screen readers", () => {
    const { container } = render(<Skeleton width={120} height={20} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("containers", () => {
  it("Sheet has a title, and Esc closes it", async () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="Ask a supervisor" description="A supervisor approves this.">
        <p>Body</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Ask a supervisor" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Sheet with a body label can be scrolled from the keyboard even when nothing in it takes focus", () => {
    render(
      <Sheet open onOpenChange={vi.fn()} title="Order 0142" bodyLabel="Order 0142 details">
        <p>Lines and totals</p>
      </Sheet>,
    );
    const body = screen.getByRole("region", { name: "Order 0142 details" });
    expect(body).toHaveAttribute("tabindex", "0");
    expect(body).toHaveTextContent("Lines and totals");
  });

  it("Dialog has a title and a way out", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Void this order?">
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole("dialog", { name: "Void this order?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Banner and Toast announce themselves; a danger banner interrupts", () => {
    render(
      <>
        <Banner tone="danger">This till can't store its key safely.</Banner>
        <Banner tone="info">An update is ready.</Banner>
        <Toast tone="success">Sent to kitchen</Toast>
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This till can't store its key safely.");
    expect(screen.getAllByRole("status").map((element) => element.textContent)).toEqual(
      expect.arrayContaining(["An update is ready.", "Sent to kitchen"]),
    );
  });

  it("a Banner inside a live region of its own leaves the announcing to it", () => {
    render(
      <div role="status" data-testid="region">
        <Banner tone="success" live={false}>
          Balanced.
        </Banner>
      </div>,
    );
    expect(screen.getAllByRole("status")).toEqual([screen.getByTestId("region")]);
  });

  it("EmptyState says what to do next", () => {
    render(<EmptyState title="No orders open" description="New orders appear here when they are started." />);
    expect(screen.getByRole("heading", { name: "No orders open" })).toBeInTheDocument();
  });

  it("PermissionNotice says who can do it and what to do now", () => {
    render(<PermissionNotice action="void orders" who="a supervisor" next="Ask one to help." />);
    expect(screen.getByRole("note")).toHaveTextContent("Only a supervisor can void orders. Ask one to help.");
  });
});

describe("SupervisorApproval", () => {
  const supervisors = [
    { id: "staff-amina", name: "Amina Hassan", roleName: "Supervisor" },
    { id: "staff-grace", name: "Grace Mushi", roleName: "Manager" },
  ];

  function renderApproval(props: Partial<SupervisorApprovalProps> = {}) {
    const handlers = { onSelect: vi.fn(), onPinKey: vi.fn(), onCancel: vi.fn() };
    render(
      <SupervisorApproval
        request="Give back TSh 9,500 in cash for 1 × Chocolate tart"
        supervisors={supervisors}
        requesterId="staff-amina"
        selectedId={null}
        pinLength={0}
        status={{ kind: "idle" }}
        {...handlers}
        {...props}
      />,
    );
    return handlers;
  }

  // F-263: Baraka, the only supervisor signed in at Bahari, opened a void: the
  // sheet said "Choose a supervisor to continue" over a keypad no one could use.
  it("when the person asking is the only supervisor, says a colleague must ask; no dead keypad", () => {
    renderApproval({ supervisors: [supervisors[0]] });
    expect(screen.getByTestId("approval-only-you")).toHaveTextContent(
      "You're the only supervisor here, and no one can approve their own request. Have a colleague sign in on this till and ask for it; you then approve it with your PIN.",
    );
    expect(screen.queryByRole("group", { name: "Supervisor PIN" })).toBeNull();
    expect(screen.queryByText("Choose a supervisor to continue")).toBeNull();
  });

  it("with another supervisor to choose, the keypad is there", () => {
    renderApproval();
    expect(screen.queryByTestId("approval-only-you")).toBeNull();
    expect(screen.getByText("Choose a supervisor to continue")).toBeInTheDocument();
  });

  // F-242: staff PINs are six digits; the pad drew four places for them.
  it("draws a place for each digit of a PIN, filled as they are keyed", () => {
    renderApproval({ selectedId: "staff-grace", pinLength: 2 });
    const dots = document.querySelectorAll(".y-pin-dots__dot");
    expect(dots).toHaveLength(PIN_LENGTH);
    expect(PIN_LENGTH).toBe(6);
    expect(document.querySelectorAll(".y-pin-dots__dot--filled")).toHaveLength(2);
  });

  it("states the request in words and lists the supervisors", async () => {
    const { onSelect } = renderApproval();
    expect(screen.getByText("Give back TSh 9,500 in cash for 1 × Chocolate tart")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Grace Mushi/ }));
    expect(onSelect).toHaveBeenCalledWith("staff-grace");
  });

  it("marks the person asking as You and doesn't offer them, with the reason", async () => {
    const { onSelect } = renderApproval();
    const own = screen.getByRole("radio", { name: /Amina Hassan/ });
    expect(own).toHaveTextContent("You");
    expect(own).toHaveAccessibleDescription("You can't approve your own request.");
    expect(own).toBeDisabled();
    await userEvent.click(own);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /Grace Mushi/ })).toBeEnabled();
  });

  it("refuses self-approval in words and keeps the PIN keypad closed", () => {
    renderApproval({ selectedId: "staff-amina" });
    expect(screen.getByRole("alert")).toHaveTextContent("You can't approve your own request. Ask another supervisor.");
    for (const key of within(screen.getByRole("group", { name: "Supervisor PIN" })).getAllByRole("button")) {
      expect(key).toBeDisabled();
    }
  });

  it("says so in words when there is no staff list to choose from, with the PIN keypad closed", () => {
    renderApproval({ supervisors: [] });
    expect(screen.getByText("This till can't show its staff list right now, so no one can approve here. Check the internet connection, then try again.")).toBeInTheDocument();
    for (const key of within(screen.getByRole("group", { name: "Supervisor PIN" })).getAllByRole("button")) {
      expect(key).toBeDisabled();
    }
  });

  it("takes the chosen supervisor's PIN and shows how many digits are in", async () => {
    const { onPinKey } = renderApproval({ selectedId: "staff-grace", pinLength: 2 });
    expect(screen.getByText("Grace Mushi, enter your PIN")).toBeInTheDocument();
    expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("2 digits entered");
    await userEvent.click(screen.getByRole("button", { name: "4" }));
    expect(onPinKey).toHaveBeenCalledWith("4");
  });

  it("shows the result in words", () => {
    renderApproval({ selectedId: "staff-grace", status: { kind: "approved", by: "Grace Mushi" } });
    expect(screen.getByRole("status")).toHaveTextContent("Approved by Grace Mushi");
  });

  it("shows a refusal in words", () => {
    renderApproval({
      selectedId: "staff-grace",
      status: { kind: "refused", reason: "That PIN didn't match. Try again." },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("That PIN didn't match. Try again.");
  });

  it("lets the person asking back out", async () => {
    const { onCancel } = renderApproval();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("leaves Cancel and Approve to a sheet's footer when asked, and the footer approves only when allowed", async () => {
    renderApproval({ actions: "none", onApprove: vi.fn() });
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    const onApprove = vi.fn();
    const { unmount } = render(<SupervisorApprovalActions onCancel={vi.fn()} onApprove={onApprove} canApprove={false} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    unmount();
    render(<SupervisorApprovalActions onCancel={vi.fn()} onApprove={onApprove} canApprove />);
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("types digits from a keyboard into the PIN", () => {
    const { onPinKey } = renderApproval({ selectedId: "staff-grace" });
    fireEvent.keyDown(screen.getByRole("group", { name: "Supervisor PIN" }), { key: "5" });
    fireEvent.keyDown(screen.getByRole("group", { name: "Supervisor PIN" }), { key: "Backspace" });
    expect(onPinKey.mock.calls.map(([key]) => key)).toEqual(["5", "delete"]);
  });
});

describe("MoneyField reads as money", () => {
  it("groups the digits as they are typed, and keeps the amount", async () => {
    const { groupedDigits } = await import("./fields");
    expect(groupedDigits("50000")).toBe("50,000");
    expect(groupedDigits("1234567")).toBe("1,234,567");
    expect(groupedDigits("950")).toBe("950");
    expect(groupedDigits("1500.5")).toBe("1,500.5");
    expect(groupedDigits("")).toBe("");
  });
});

// The owner, 2026-10-19: people in their own colour on the sign-in screen and wherever they appear.
describe("Avatar", () => {
  it("gives a person the same colour every time, one of the four", async () => {
    const { Avatar, avatarTone } = await import("./display");
    expect(avatarTone("Zawadi Said")).toBe(avatarTone(" zawadi said "));
    const tones = new Set(["Amina Hassan", "Baraka Mushi", "Grace Mushi", "Juma Ally", "Neema Mwakyusa", "Rehema Swai", "Zawadi Said"].map(avatarTone));
    for (const tone of tones) expect([1, 2, 3, 4]).toContain(tone);
    expect(tones.size).toBeGreaterThan(1);
    render(<Avatar name="Zawadi Said" initials="ZS" />);
    const avatar = screen.getByText("ZS");
    expect(avatar).toHaveAttribute("data-tone", String(avatarTone("Zawadi Said")));
    expect(avatar).toHaveAttribute("aria-hidden", "true");
  });
});
