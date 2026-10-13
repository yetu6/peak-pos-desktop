/*
 * Yetu till: put the right theme on the page before the first paint, so a
 * kitchen display never flashes Light and a Dark till never flashes white.
 *
 * Loaded by index.html as a blocking script at the top of <body>, before the
 * app's own code and stylesheet. A file rather than inline code, so the
 * till's content security policy ('self' only) allows it as it stands.
 *
 * It must reach the same theme as bootTheme() in src/lib/theme.ts:
 * src/lib/themeBoot.test.ts runs both over the same storage and compares.
 * The colours are the themes' canvas (THEME_CANVAS in displayDefaults.ts).
 */
(function () {
  const CANVAS = { light: "#eef1f6", dark: "#0a1626" };
  let theme = "light";
  try {
    const store = window.localStorage;
    // The old switch wrote this on every start, so it never recorded a choice.
    store.removeItem("peak-pos-theme");
    const choice = store.getItem("yetu-till-theme");
    const modeDefault = store.getItem("yetu-till-mode-theme");
    if (choice === "light" || choice === "dark") theme = choice;
    else if (modeDefault === "light" || modeDefault === "dark") theme = modeDefault;
  } catch {
    theme = "light";
  }
  const body = document.body;
  body.classList.toggle("dark-theme", theme === "dark");
  body.classList.toggle("dark", theme === "dark");
  body.classList.toggle("light-theme", theme === "light");
  const page = document.documentElement;
  page.style.backgroundColor = CANVAS[theme];
  page.style.colorScheme = theme;
})();
