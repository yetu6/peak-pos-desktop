import { useEffect, useState } from "react";
import { Icon } from "./Icon";

const STORAGE_KEY = "peak-pos-theme";

function initialTheme(): "light" | "dark" {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Applies the Safari POS dark theme by toggling `.dark-theme` on <body>. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);

  useEffect(() => {
    document.body.classList.toggle("dark-theme", theme === "dark");
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <button
      data-testid="theme-toggle"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      className="flex h-8 w-14 items-center justify-between rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-secondary)] p-0.5 transition-colors"
    >
      <span
        className={`flex h-[26px] w-[26px] items-center justify-center rounded-full transition-transform duration-300 ${
          theme === "dark" ? "translate-x-6 bg-[var(--color-success)] text-white" : "bg-[var(--color-brand)] text-white"
        }`}
      >
        <Icon name={theme === "dark" ? "bolt" : "clock"} size={14} />
      </span>
    </button>
  );
}