import { useEffect, useState } from "react";
import { Icon } from "./Icon";

const STORAGE_KEY = "peak-pos-theme";

function initialTheme(): "light" | "dark" {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return "dark";
}

/** Peak Terminal is dark-first while retaining a per-device light option. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);

  useEffect(() => {
    document.body.classList.toggle("dark-theme", theme === "dark");
    document.body.classList.toggle("dark", theme === "dark");
    document.body.classList.toggle("light-theme", theme === "light");
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <button
      data-testid="theme-toggle"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      className="flex h-11 w-16 items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-interactive)] p-1 transition-colors"
    >
      <span
        className={`flex size-8 items-center justify-center rounded-full transition-transform duration-150 ${
          theme === "dark" ? "translate-x-6 bg-[var(--primary)] text-white" : "bg-[var(--gold-accent)] text-[#17120a]"
        }`}
      >
        <Icon name={theme === "dark" ? "bolt" : "clock"} size={14} />
      </span>
    </button>
  );
}
