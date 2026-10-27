import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { BrandLockup } from "./BrandLockup";

describe("BrandLockup", () => {
  it("shows one Yetu wordmark, the blue one, in every theme", () => {
    const { container } = render(<BrandLockup />);
    const marks = [...container.querySelectorAll<HTMLImageElement>("img")].filter((img) => img.alt === "Yetu");
    expect(marks).toHaveLength(1);
    expect(marks[0].className).toContain("brand-lockup__wordmark");
    expect(marks[0].getAttribute("src")).toContain("yetu-wordmark-ink");
    expect(container.innerHTML).not.toMatch(/wordmark-white/);
  });
  it("puts the blue wordmark on a light badge on dark surfaces, never turning it white", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css).toMatch(/body\.dark-theme \.brand-lockup \.brand-lockup__wordmark[\s\S]*?background:\s*#fff/);
    expect(css).toMatch(/brand-lockup--on-dark \.brand-lockup__wordmark/);
  });
});
