import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangePinSheet } from "./ChangePinSheet";

const { changeOwnPin } = vi.hoisted(() => ({
  changeOwnPin: vi.fn(async (_current: string, _next: string): Promise<unknown> => ({ response: new Response(null, { status: 204 }) })),
}));
vi.mock("../lib/posApi", () => ({ createPosApi: () => ({ changeOwnPin }) }));

const answer = (status: number, body?: unknown) => ({
  error: body,
  response: new Response(body === undefined ? null : JSON.stringify(body), { status }),
});

async function type(digits: string) {
  for (const digit of digits) await userEvent.click(screen.getByTestId(`change-pin-key-${digit}`));
}

function open() {
  const onChanged = vi.fn();
  const onOpenChange = vi.fn();
  render(<ChangePinSheet open onOpenChange={onOpenChange} onChanged={onChanged} />);
  return { onChanged, onOpenChange };
}

// Owner, 2026-11-07 (approved from a mockup): anyone signed in changes their
// own PIN with the one they use now; nobody approves it.
describe("Change my PIN", () => {
  beforeEach(() => {
    changeOwnPin.mockReset();
    changeOwnPin.mockImplementation(async () => answer(204));
  });

  it("the PIN now, then the new one twice; Yetu is asked once, and the till learns the new PIN", async () => {
    const { onChanged, onOpenChange } = open();
    expect(screen.getByTestId("change-pin-step")).toHaveTextContent("Enter your PIN now");
    await type("583920");
    expect(screen.getByTestId("change-pin-step")).toHaveTextContent("Choose a new six-digit PIN");
    await type("204815");
    expect(screen.getByTestId("change-pin-step")).toHaveTextContent("Type it again");
    expect(changeOwnPin).not.toHaveBeenCalled();
    await type("204815");
    await waitFor(() => expect(changeOwnPin).toHaveBeenCalledWith("583920", "204815"));
    expect(onChanged).toHaveBeenCalledWith("204815");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("two different new PINs are chosen again, before anything goes to Yetu", async () => {
    open();
    await type("583920");
    await type("204815");
    await type("204816");
    expect(screen.getByTestId("change-pin-error")).toHaveTextContent("The two PINs were different.");
    expect(screen.getByTestId("change-pin-step")).toHaveTextContent("Choose a new six-digit PIN");
    expect(changeOwnPin).not.toHaveBeenCalled();
  });

  it("not their PIN now: back to it, in Yetu's words, and nothing changes", async () => {
    changeOwnPin.mockImplementationOnce(async () => answer(403, { code: "POS_CURRENT_PIN_WRONG", detail: "That isn't your PIN now. Try again." }));
    const { onChanged } = open();
    await type("918273");
    await type("204815");
    await type("204815");
    await waitFor(() => expect(screen.getByTestId("change-pin-error")).toHaveTextContent("That isn't your PIN now. Try again."));
    expect(screen.getByTestId("change-pin-step")).toHaveTextContent("Enter your PIN now");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a new PIN Yetu refuses is chosen again, saying why", async () => {
    changeOwnPin.mockImplementationOnce(async () => answer(422, { code: "VALIDATION_FAILED", detail: "Choose a new six-digit PIN: not the one you use now." }));
    open();
    await type("583920");
    await type("111111");
    await type("111111");
    await waitFor(() => expect(screen.getByTestId("change-pin-error")).toHaveTextContent("not the one you use now"));
    expect(screen.getByTestId("change-pin-step")).toHaveTextContent("Choose a new six-digit PIN");
  });

  it("without internet it says so; the PIN stays as it was", async () => {
    changeOwnPin.mockImplementationOnce(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { onChanged } = open();
    await type("583920");
    await type("204815");
    await type("204815");
    await waitFor(() => expect(screen.getByTestId("change-pin-error")).toHaveTextContent("Changing your PIN needs the internet."));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
