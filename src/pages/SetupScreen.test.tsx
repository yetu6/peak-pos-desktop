import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SetupScreen } from "./SetupScreen";

const session = vi.hoisted(() => ({
  saveApiUrl: vi.fn(async (_url: string) => undefined),
  error: null as string | null,
}));

vi.mock("../auth/DeviceSessionProvider", () => ({
  useDeviceSession: () => ({ saveApiUrl: session.saveApiUrl, error: session.error }),
}));

beforeEach(() => {
  session.saveApiUrl.mockClear();
  session.error = null;
});

describe("SetupScreen", () => {
  it("asks for the Yetu server in plain words, with no installer talk", () => {
    render(<SetupScreen />);
    expect(screen.getByRole("heading", { name: "Connect to your Yetu server" })).toBeInTheDocument();
    expect(screen.getByTestId("setup-screen")).not.toHaveTextContent(/installer|configuration|Peak/i);
    expect(screen.getByRole("textbox", { name: "Server address" })).toHaveAccessibleDescription(/https:\/\//);
  });

  it("checks the address before saving, and says what is wrong in words", async () => {
    render(<SetupScreen />);
    const field = screen.getByTestId("peak-url");
    await userEvent.clear(field);
    await userEvent.type(field, "http://yetu.example.com");
    await userEvent.click(screen.getByTestId("save-peak-url"));
    expect(session.saveApiUrl).not.toHaveBeenCalled();
    expect(screen.getByTestId("setup-error")).toHaveTextContent("The address must start with https://");
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("saves a good address", async () => {
    render(<SetupScreen />);
    const field = screen.getByTestId("peak-url");
    await userEvent.clear(field);
    await userEvent.type(field, "https://api.yetu.fbcsoftwares.com{Enter}");
    expect(session.saveApiUrl).toHaveBeenCalledWith("https://api.yetu.fbcsoftwares.com");
  });

  it("puts the rules and the version behind Technical details", () => {
    render(<SetupScreen />);
    const details = screen.getByText("Technical details").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(/https/i);
    expect(details).toHaveTextContent(/version/i);
  });

  it("words a save failure from the device session", () => {
    session.error = "Something went wrong. Try again.";
    render(<SetupScreen />);
    expect(screen.getByTestId("setup-error")).toHaveTextContent("Something went wrong. Try again.");
  });
});
