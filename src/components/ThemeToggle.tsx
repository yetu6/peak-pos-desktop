import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";

/**
 * The per-device theme switch in the top bar. Light and Dark are equal
 * themes; the choice is remembered on this device (`yetu-till-theme`). A
 * device nobody has chosen for follows its mode's default (displayDefaults.ts).
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={toggle}
      className="y-button y-button--quiet y-button--48 y-theme-toggle"
    >
      {next === "dark" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
      <span className="y-theme-toggle__label">{next === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}
