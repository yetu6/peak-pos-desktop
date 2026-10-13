import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffLoginRejectedError, humanDeviceError } from "../lib/deviceAuth";
import { PinUnlock } from "./PinUnlock";

const { unlock, store } = vi.hoisted(() => {
  let value: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  return {
    unlock: vi.fn(async (_staffNumber: string, _pin: string) => undefined),
    // Like the real provider, a change to the session re-renders whoever reads it.
    store: {
      get: () => value,
      set(next: Record<string, unknown>) {
        value = next;
        for (const listener of listeners) listener();
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});

vi.mock("../auth/DeviceSessionProvider", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useDeviceSession: () => useSyncExternalStore(store.subscribe, store.get) };
});

const useDeviceSessionMock = { mockReturnValue: (value: Record<string, unknown>) => store.set(value) };

const REJECTED = humanDeviceError(new StaffLoginRejectedError());
const OFFLINE_REJECTED = "That staff number or offline PIN was not accepted.";

function baseSession(overrides: Record<string, unknown> = {}) {
  return {
    unlock,
    error: null,
    identity: { terminalName: "Bar 1" },
    roster: [],
    offlineEligibility: null,
    ...overrides,
  };
}

const TWO = [
  { fullName: "Amina Hassan", staffNumber: "00001" },
  { fullName: "Grace Mushi", staffNumber: "00002" },
];

async function typePin(digits: string): Promise<void> {
  for (const digit of digits) {
    await userEvent.click(screen.getByTestId(`pin-key-${digit}`));
  }
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
}

beforeEach(() => {
  unlock.mockReset();
  unlock.mockImplementation(async () => undefined);
  setOnline(true);
});

afterEach(() => {
  setOnline(true);
});

describe("PinUnlock", () => {
  it("goes straight to manual staff-number entry when the roster is empty", () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: [] }));
    render(<PinUnlock />);

    expect(screen.queryByTestId("staff-roster")).not.toBeInTheDocument();
    expect(screen.getByTestId("staff-number")).toBeInTheDocument();
  });

  it("opens on the names once the roster arrives (it is still loading when the screen opens)", () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: [] }));
    render(<PinUnlock />);
    expect(screen.getByTestId("staff-number")).toBeInTheDocument();
    act(() => useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO })));
    expect(screen.getByTestId("staff-roster")).toBeInTheDocument();
    expect(screen.queryByTestId("staff-number")).not.toBeInTheDocument();
  });

  it("keeps the staff number entry for a person who started typing before the names arrived", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: [] }));
    render(<PinUnlock />);
    await userEvent.type(screen.getByTestId("staff-number"), "000");
    act(() => useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO })));
    expect(screen.getByTestId("staff-number")).toHaveValue("000");
    expect(screen.queryByTestId("staff-roster")).not.toBeInTheDocument();
  });

  it("shows a tap-to-select roster and unlocks with the tapped staff member's number", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO }));
    render(<PinUnlock />);

    expect(screen.getByTestId("staff-roster")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Who's working?" })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("roster-entry-00001"));
    expect(screen.getByTestId("selected-staff-name")).toHaveTextContent("Amina Hassan");

    await typePin("418205");

    expect(unlock).toHaveBeenCalledWith("00001", "418205");
  });

  it("falls back to manual entry from the roster screen", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: [TWO[0]] }));
    render(<PinUnlock />);

    expect(screen.getByTestId("staff-manual-entry")).toHaveTextContent("Use staff number instead");
    await userEvent.click(screen.getByTestId("staff-manual-entry"));
    expect(screen.queryByTestId("staff-roster")).not.toBeInTheDocument();
    expect(screen.getByTestId("staff-number")).toBeInTheDocument();
  });

  it("lets a roster selection be changed before unlocking", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: [TWO[0]] }));
    render(<PinUnlock />);

    await userEvent.click(screen.getByTestId("roster-entry-00001"));
    expect(screen.getByTestId("selected-staff-name")).toHaveTextContent("Amina Hassan");

    await userEvent.click(screen.getByTestId("staff-change"));
    expect(screen.getByTestId("staff-roster")).toBeInTheDocument();
  });
});

describe("PIN entry", () => {
  it("submits by itself when the 6th digit is in: no OK, no Unlock", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO }));
    render(<PinUnlock />);
    await userEvent.click(screen.getByTestId("roster-entry-00002"));

    expect(screen.queryByRole("button", { name: /^(OK|Unlock)$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("pin-unlock")).not.toBeInTheDocument();
    await typePin("41820");
    expect(unlock).not.toHaveBeenCalled();
    expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("5 of 6 digits entered");
    await typePin("5");
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledWith("00002", "418205");
  });

  it("takes the PIN from a keyboard too, with Backspace", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO }));
    render(<PinUnlock />);
    await userEvent.click(screen.getByTestId("roster-entry-00001"));
    (document.activeElement as HTMLElement | null)?.blur();

    for (const key of ["4", "1", "9", "Backspace", "8", "2", "0", "5"]) {
      fireEvent.keyDown(window, { key });
    }
    await act(async () => undefined);
    expect(unlock).toHaveBeenCalledWith("00001", "418205");
  });

  it("ignores keys pressed while an input method is composing", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO }));
    render(<PinUnlock />);
    await userEvent.click(screen.getByTestId("roster-entry-00001"));
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "4", isComposing: true });
    fireEvent.keyDown(window, { key: "4", keyCode: 229 });
    expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("0 of 6 digits entered");
    fireEvent.keyDown(window, { key: "4" });
    expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("1 of 6 digits entered");
  });

  it("signs in by staff number and PIN when typed by hand", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: [] }));
    render(<PinUnlock />);

    await userEvent.type(screen.getByTestId("staff-number"), "00042");
    await typePin("418205");
    expect(unlock).toHaveBeenCalledWith("00042", "418205");
  });

  it("asks for the staff number before checking a PIN typed without one", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: [] }));
    render(<PinUnlock />);

    await typePin("418205");
    expect(unlock).not.toHaveBeenCalled();
    expect(screen.getByTestId("pin-error")).toHaveTextContent("Type your staff number first.");
  });

  it("clears the PIN and says it didn't match, then that it is paused after 5 wrong tries", async () => {
    store.set(baseSession({ roster: TWO }));
    unlock.mockImplementation(async () => {
      store.set({ ...store.get(), error: REJECTED });
    });
    render(<PinUnlock />);
    await userEvent.click(screen.getByTestId("roster-entry-00001"));

    await typePin("111111");
    expect(screen.getByTestId("pin-error")).toHaveTextContent("That PIN didn't match. Try again.");
    expect(screen.getByTestId("pin-dots")).toHaveAccessibleName("0 of 6 digits entered");

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await typePin("111111");
      await waitFor(() => expect(unlock).toHaveBeenCalledTimes(attempt));
    }
    expect(unlock).toHaveBeenCalledTimes(5);
    expect(screen.getByTestId("pin-error")).toHaveTextContent(
      "Too many tries. Your PIN may be paused for a minute — wait, then try again, or ask a manager.",
    );
  });

  it("never counts offline refusals toward the online pause", async () => {
    store.set(baseSession({ roster: TWO }));
    unlock.mockImplementation(async () => {
      store.set({ ...store.get(), error: OFFLINE_REJECTED });
    });
    render(<PinUnlock />);
    await userEvent.click(screen.getByTestId("roster-entry-00001"));
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await typePin("111111");
      await waitFor(() => expect(unlock).toHaveBeenCalledTimes(attempt));
    }
    expect(screen.getByTestId("pin-error")).toHaveTextContent(
      "That PIN didn't match. Without internet, each wrong try makes the next one wait longer.",
    );
  });

  it("starts the online count afresh after offline refusals", async () => {
    store.set(baseSession({ roster: TWO }));
    let calls = 0;
    unlock.mockImplementation(async () => {
      calls += 1;
      store.set({ ...store.get(), error: calls <= 4 ? OFFLINE_REJECTED : REJECTED });
    });
    render(<PinUnlock />);
    await userEvent.click(screen.getByTestId("roster-entry-00001"));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await typePin("111111");
      await waitFor(() => expect(unlock).toHaveBeenCalledTimes(attempt));
    }
    expect(screen.getByTestId("pin-error")).toHaveTextContent("That PIN didn't match. Try again.");
  });

  it("announces a repeated refusal again and puts focus back on the keypad", async () => {
    store.set(baseSession({ roster: TWO }));
    unlock.mockImplementation(async () => {
      store.set({ ...store.get(), error: REJECTED });
    });
    render(<PinUnlock />);
    await userEvent.click(screen.getByTestId("roster-entry-00001"));

    // Typed on a keyboard with focus on the page: after the refusal focus lands on the keypad.
    (document.activeElement as HTMLElement | null)?.blur();
    for (const key of "111111") fireEvent.keyDown(window, { key });
    await waitFor(() => expect(unlock).toHaveBeenCalledTimes(1));
    const first = await screen.findByTestId("pin-error");
    expect(first).toHaveAttribute("role", "alert");
    expect(screen.getByRole("group", { name: "PIN" })).toContainElement(document.activeElement as HTMLElement);

    await typePin("222222");
    await waitFor(() => expect(unlock).toHaveBeenCalledTimes(2));
    const second = await screen.findByTestId("pin-error");
    expect(second).toHaveTextContent(first.textContent ?? "");
    expect(second).not.toBe(first);
    expect(screen.getByRole("group", { name: "PIN" })).toContainElement(document.activeElement as HTMLElement);
  });

  it("says a typed staff number and PIN didn't match", async () => {
    store.set(baseSession({ roster: [] }));
    unlock.mockImplementation(async () => {
      store.set({ ...store.get(), error: REJECTED });
    });
    render(<PinUnlock />);
    await userEvent.type(screen.getByTestId("staff-number"), "00042");
    await typePin("111111");
    expect(screen.getByTestId("pin-error")).toHaveTextContent("That staff number and PIN didn't match. Try again.");
  });

  it("tells a person whose session ended to carry on, as information", () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO, error: "Session expired — enter your PIN again" }));
    render(<PinUnlock />);
    expect(screen.getByTestId("pin-notice")).toHaveTextContent("Your session ended. Enter your PIN to carry on.");
    expect(screen.queryByTestId("pin-error")).not.toBeInTheDocument();
  });
});

describe("Who's working", () => {
  function roster(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      fullName: `Person ${String(index + 1).padStart(2, "0")}`,
      staffNumber: String(index + 1).padStart(5, "0"),
    }));
  }

  it("offers a search only when more than 12 people work here", async () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: roster(12) }));
    const { unmount } = render(<PinUnlock />);
    expect(screen.queryByRole("searchbox", { name: "Find your name" })).not.toBeInTheDocument();
    unmount();

    useDeviceSessionMock.mockReturnValue(baseSession({ roster: [...roster(12), { fullName: "Zawadi Kimaro", staffNumber: "00099" }] }));
    render(<PinUnlock />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Find your name" }), "zaw");
    expect(screen.getByTestId("roster-entry-00099")).toBeInTheDocument();
    expect(screen.queryByTestId("roster-entry-00001")).not.toBeInTheDocument();
  });

  it("shows a banner when the till has no network", () => {
    setOnline(false);
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO }));
    render(<PinUnlock />);
    expect(screen.getByTestId("offline-banner")).toHaveTextContent(
      "Working offline. Only cash sales are possible until the connection returns.",
    );
  });

  it("follows the network going away and coming back", () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO }));
    render(<PinUnlock />);
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });

  it("says what working offline would mean here, in words", () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO, offlineEligibility: { state: "ELIGIBLE" } }));
    render(<PinUnlock />);
    expect(screen.getByTestId("offline-authority-state")).toHaveTextContent(
      "If the internet drops, this till can keep taking cash for staff who have signed in here before.",
    );
  });

  it("shows the till's name", () => {
    useDeviceSessionMock.mockReturnValue(baseSession({ roster: TWO }));
    render(<PinUnlock />);
    expect(screen.getByTestId("till-name")).toHaveTextContent("Bar 1");
  });
});

describe("too many sign-in attempts (429)", () => {
  it("holds the keypad until Yetu's wait is over, saying so", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useDeviceSessionMock.mockReturnValue(
        baseSession({ roster: TWO, error: "Too many sign-in attempts. Wait before trying again.", signInHeldUntil: Date.now() + 45_000 }),
      );
      render(<PinUnlock />);
      await userEvent.click(screen.getByTestId("roster-entry-00001"));
      expect(screen.getByRole("alert")).toHaveTextContent("Too many attempts. Wait a minute and try again.");
      expect(screen.getByTestId("pin-key-1")).toBeDisabled();
      act(() => vi.advanceTimersByTime(45_000));
      expect(screen.getByTestId("pin-key-1")).toBeEnabled();
      expect(screen.queryByText(/Too many attempts/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't take a PIN from the keyboard during the wait either", async () => {
    useDeviceSessionMock.mockReturnValue(
      baseSession({ roster: TWO, error: "Too many sign-in attempts. Wait before trying again.", signInHeldUntil: Date.now() + 45_000 }),
    );
    render(<PinUnlock />);
    await userEvent.click(screen.getByTestId("roster-entry-00001"));
    await userEvent.keyboard("418205");
    expect(unlock).not.toHaveBeenCalled();
  });

  it("names the time when the wait is longer than a minute", async () => {
    useDeviceSessionMock.mockReturnValue(
      baseSession({ roster: TWO, error: "Too many sign-in attempts. Wait before trying again.", signInHeldUntil: Date.now() + 30 * 60_000 }),
    );
    render(<PinUnlock />);
    await userEvent.click(screen.getByTestId("roster-entry-00001"));
    expect(screen.getByRole("alert")).toHaveTextContent(/^Too many attempts\. Wait until \d\d:\d\d and try again\.$/);
  });
});
