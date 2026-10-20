import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReasonPicker } from "./ReasonPicker";

const REASONS = ["Regular guest", "Staff meal", "Slow service"];

describe("ReasonPicker", () => {
  it("gives the reason in one tap, from the place's list", async () => {
    const onChange = vi.fn();
    render(<ReasonPicker label="Reason" reasons={REASONS} onChange={onChange} testIdPrefix="discount-reason" />);
    const group = screen.getByRole("radiogroup", { name: "Reason" });
    expect(group).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Staff meal" }));
    expect(onChange).toHaveBeenLastCalledWith("Staff meal");
    expect(screen.getByRole("radio", { name: "Staff meal" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("discount-reason-1")).toBe(screen.getByRole("radio", { name: "Staff meal" }));
  });

  it("opens a box to type only for another reason, and gives what is typed", async () => {
    const onChange = vi.fn();
    render(
      <ReasonPicker
        label="Reason"
        reasons={REASONS}
        onChange={onChange}
        otherHint="Written in the order's history."
        testIdPrefix="discount-reason"
      />,
    );
    await userEvent.click(screen.getByTestId("discount-reason-other"));
    expect(onChange).toHaveBeenLastCalledWith("");
    const box = screen.getByRole("textbox", { name: "The reason" });
    expect(box).toHaveFocus();
    expect(screen.getByText("Written in the order's history.")).toBeInTheDocument();

    await userEvent.type(box, "Birthday");
    expect(onChange).toHaveBeenLastCalledWith("Birthday");

    // Back to a listed reason: the typed words are no longer the reason.
    await userEvent.click(screen.getByRole("radio", { name: "Regular guest" }));
    expect(onChange).toHaveBeenLastCalledWith("Regular guest");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("starts on a reason it was given: listed, or typed as another", () => {
    const { unmount } = render(
      <ReasonPicker label="Reason" reasons={REASONS} initialReason="Slow service" onChange={vi.fn()} testIdPrefix="r" />,
    );
    expect(screen.getByRole("radio", { name: "Slow service" })).toHaveAttribute("aria-checked", "true");
    unmount();

    render(<ReasonPicker label="Reason" reasons={REASONS} initialReason="Gas delivery" onChange={vi.fn()} testIdPrefix="r" />);
    expect(screen.getByTestId("r-other")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("textbox", { name: "The reason" })).toHaveValue("Gas delivery");
  });
});
