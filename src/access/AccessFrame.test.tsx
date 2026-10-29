import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { packagedAppVersion } from "../lib/diagnostics";
import { AccessFrame } from "./AccessLayout";

describe("AccessFrame", () => {
  it("shows the running version quietly at the foot of every screen before sign-in", () => {
    render(
      <AccessFrame>
        <p>Who&apos;s working</p>
      </AccessFrame>,
    );
    expect(packagedAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
    expect(screen.getByTestId("app-version")).toHaveTextContent(`Yetu ${packagedAppVersion()}`);
  });
});
