import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_CANVAS } from "./lib/displayDefaults";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const brandCss = read("src/fbc-tokens.css");
const tokensCss = read("src/styles/tokens.css");
const indexCss = read("src/index.css");
const systemCss = read("src/components/system/system.css");
const allCss = [brandCss, tokensCss, indexCss, systemCss].join("\n");
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json")) as {
  app: { windows: Array<Record<string, unknown>> };
};

// ---------------------------------------------------------------------------
// A small reader for the token files: top-level blocks and their declarations.
// ---------------------------------------------------------------------------

interface Block {
  selector: string;
  atRule: string | null;
  declarations: Record<string, string>;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function blocks(css: string): Block[] {
  const text = stripComments(css);
  const found: Block[] = [];
  const stack: Array<{ header: string; start: number }> = [];
  let headerStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") {
      stack.push({ header: text.slice(headerStart, index).trim(), start: index + 1 });
      headerStart = index + 1;
    } else if (char === "}") {
      const open = stack.pop();
      if (open && !open.header.startsWith("@")) {
        const parent = stack.at(-1)?.header ?? null;
        const declarations: Record<string, string> = {};
        for (const match of text.slice(open.start, index).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
          declarations[match[1]] = match[2].trim();
        }
        found.push({ selector: open.header.split(";").at(-1)!.trim(), atRule: parent, declarations });
      }
      headerStart = index + 1;
    } else if (char === ";" && stack.length === 0) {
      headerStart = index + 1;
    }
  }
  return found;
}

const brand = Object.assign({}, ...blocks(brandCss).map((block) => block.declarations)) as Record<string, string>;
const tokenBlocks = blocks(tokensCss);
const lightDeclarations = Object.assign(
  {},
  ...tokenBlocks
    .filter((block) => block.atRule === null && block.selector.split(",").map((part) => part.trim()).includes(":root"))
    .map((block) => block.declarations),
) as Record<string, string>;
const darkDeclarations = Object.assign(
  {},
  ...tokenBlocks.filter((block) => block.selector === "body.dark-theme" && block.atRule === null).map((block) => block.declarations),
) as Record<string, string>;

type Theme = "light" | "dark";
const THEMES: Record<Theme, Record<string, string>> = {
  light: { ...brand, ...lightDeclarations },
  dark: { ...brand, ...lightDeclarations, ...darkDeclarations },
};

function resolve(theme: Theme, name: string, seen: string[] = []): string {
  if (seen.includes(name)) throw new Error(`Token cycle: ${[...seen, name].join(" -> ")}`);
  const value = THEMES[theme][name];
  if (value === undefined) throw new Error(`Token ${name} is not defined for ${theme}`);
  const reference = value.match(/^var\((--[\w-]+)(?:\s*,[^)]*)?\)$/);
  return reference ? resolve(theme, reference[1], [...seen, name]) : value;
}

function colour(theme: Theme, name: string): string {
  const value = resolve(theme, name).toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(value)) throw new Error(`${name} in ${theme} is ${value}, not a #rrggbb colour`);
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function ratio(theme: Theme, foreground: string, background: string): number {
  return contrast(colour(theme, foreground), colour(theme, background));
}

// Every surface text can sit on, and every colour text is drawn in.
const SURFACES = ["--canvas", "--surface", "--surface-raised", "--surface-hover", "--surface-selected"];
const TEXT = [
  "--text",
  "--text-muted",
  "--action-text",
  "--accent-text",
  "--success",
  "--warning",
  "--danger",
  "--info",
];
const STATUS = ["success", "warning", "danger", "info"] as const;

describe("Yetu till tokens", () => {
  it("adopts the Yetu brand ramp", () => {
    expect(brand["--fbc-ink"]).toBe("#10417c");
    expect(brand["--fbc-accent"]).toBe("#f75e2d");
    expect(indexCss).toMatch(/@import\s+"\.\/fbc-tokens\.css"/);
    expect(indexCss).toMatch(/@import\s+"\.\/styles\/tokens\.css"/);
    expect(indexCss).toMatch(/@import\s+"\.\/components\/system\/system\.css"/);
  });

  it("defines every semantic token in both themes", () => {
    const required = [
      ...SURFACES,
      ...TEXT,
      "--action",
      "--action-hover",
      "--on-action",
      "--accent",
      "--on-accent",
      "--accent-subtle",
      "--on-danger",
      "--focus",
      "--line",
      "--line-strong",
      "--line-control",
      ...STATUS.flatMap((status) => [`--${status}-subtle`, `--${status}-line`]),
    ];
    for (const theme of ["light", "dark"] as const) {
      for (const name of required) {
        expect(() => colour(theme, name), `${name} (${theme})`).not.toThrow();
      }
    }
    // Dark is its own set of values, not the light set reused.
    const differing = SURFACES.filter((name) => colour("light", name) !== colour("dark", name));
    expect(differing).toEqual(SURFACES);
  });

  it("paints the page before the stylesheet in each theme's own canvas colour", () => {
    expect(THEME_CANVAS.light).toBe(colour("light", "--canvas"));
    expect(THEME_CANVAS.dark).toBe(colour("dark", "--canvas"));
  });

  it("makes Yetu Blue the action colour and keeps orange off ordinary actions", () => {
    expect(colour("light", "--action")).toBe(brand["--fbc-ink"]);
    expect(colour("dark", "--action")).toBe(brand["--fbc-ink-300"]);
    for (const theme of ["light", "dark"] as const) {
      expect(colour(theme, "--accent")).toBe(brand["--fbc-accent"]);
      expect(colour(theme, "--action")).not.toBe(colour(theme, "--accent"));
      expect(colour(theme, "--primary")).toBe(colour(theme, "--action"));
      expect(colour(theme, "--focus")).not.toBe(colour(theme, "--accent"));
    }
  });

  it("names every surface and text colour the contrast checks cover", () => {
    const declared = new Set([...Object.keys(lightDeclarations), ...Object.keys(darkDeclarations)]);
    // A legacy alias of a listed surface (e.g. --surface-interactive) is covered through what it points at.
    const isAlias = (name: string) => /^var\(--(canvas|surface[-\w]*)\)$/.test(lightDeclarations[name] ?? "");
    const surfaces = [...declared].filter((name) => /^--(canvas|surface(-[a-z]+)?)$/.test(name) && !isAlias(name));
    expect(surfaces.sort()).toEqual([...SURFACES].sort());
    const texts = [...declared].filter((name) => /^--(text(-[a-z]+)?|[a-z]+-text)$/.test(name));
    expect(texts.sort()).toEqual(TEXT.filter((name) => name.includes("text")).sort());
  });

  for (const theme of ["light", "dark"] as const) {
    describe(`${theme} theme contrast (WCAG 2.2 AA)`, () => {
      it("holds every text colour to 4.5:1 on every surface", () => {
        const failures: string[] = [];
        for (const text of TEXT) {
          for (const surface of SURFACES) {
            const value = ratio(theme, text, surface);
            if (value < 4.5) failures.push(`${text} on ${surface}: ${value.toFixed(2)}`);
          }
        }
        expect(failures).toEqual([]);
      });

      it("holds status words and body text to 4.5:1 on each status fill", () => {
        const failures: string[] = [];
        for (const status of STATUS) {
          for (const text of [`--${status}`, "--text", "--text-muted"]) {
            const value = ratio(theme, text, `--${status}-subtle`);
            if (value < 4.5) failures.push(`${text} on --${status}-subtle: ${value.toFixed(2)}`);
          }
        }
        for (const text of ["--accent-text", "--text"]) {
          const value = ratio(theme, text, "--accent-subtle");
          if (value < 4.5) failures.push(`${text} on --accent-subtle: ${value.toFixed(2)}`);
        }
        expect(failures).toEqual([]);
      });

      it("holds words on filled buttons and markers to 4.5:1", () => {
        expect(ratio(theme, "--on-action", "--action")).toBeGreaterThanOrEqual(4.5);
        expect(ratio(theme, "--on-action", "--action-hover")).toBeGreaterThanOrEqual(4.5);
        expect(ratio(theme, "--on-danger", "--danger")).toBeGreaterThanOrEqual(4.5);
        expect(ratio(theme, "--on-accent", "--accent")).toBeGreaterThanOrEqual(4.5);
      });

      it("keeps the focus ring, control edges and action fills at 3:1 against every surface", () => {
        const failures: string[] = [];
        for (const edge of ["--focus", "--line-control", "--action"]) {
          for (const surface of SURFACES) {
            const value = ratio(theme, edge, surface);
            if (value < 3) failures.push(`${edge} on ${surface}: ${value.toFixed(2)}`);
          }
        }
        expect(failures).toEqual([]);
      });
    });
  }

  it("declares every token that follows the theme where the theme class is, so Dark reaches it", () => {
    // CSS resolves var() where a custom property is declared. A token declared
    // only on :root that reads a Dark-overridden token is frozen at its Light
    // value for everything under body.dark-theme.
    const varying = new Set(Object.keys(darkDeclarations));
    let grew = true;
    while (grew) {
      grew = false;
      for (const [name, value] of Object.entries(lightDeclarations)) {
        if (varying.has(name)) continue;
        const references = [...value.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
        if (references.some((reference) => varying.has(reference))) {
          varying.add(name);
          grew = true;
        }
      }
    }
    const onBody = new Set(
      tokenBlocks
        .filter((block) => block.atRule === null && block.selector.split(",").map((part) => part.trim()).includes("body"))
        .flatMap((block) => Object.keys(block.declarations)),
    );
    const frozen = [...varying].filter((name) => !(name in darkDeclarations) && !onBody.has(name));
    expect(frozen).toEqual([]);
  });

  it("keeps the legacy names the existing screens read as aliases of the new tokens", () => {
    const aliases: Record<string, string> = {
      "--background": "--canvas",
      "--foreground": "--text",
      "--foreground-muted": "--text-muted",
      "--primary": "--action",
      "--primary-hover": "--action-hover",
      "--primary-foreground": "--on-action",
      "--surface-interactive": "--surface-hover",
      "--border-subtle": "--line",
      "--border": "--line-strong",
      "--border-strong": "--line-control",
      "--gold-accent": "--action-text",
      "--brass": "--action-text",
      "--gold-subtle": "--surface-selected",
      "--ring": "--focus",
      "--destructive": "--danger",
      "--success-border": "--success-line",
      "--warning-border": "--warning-line",
      "--danger-border": "--danger-line",
      "--offline": "--warning",
    };
    for (const theme of ["light", "dark"] as const) {
      for (const [legacy, current] of Object.entries(aliases)) {
        expect(colour(theme, legacy), `${legacy} (${theme})`).toBe(colour(theme, current));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Every variable and theme colour the code reads must exist.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const sources = sourceFiles("src").map((path) => ({ path, text: read(path) }));
const definedVariables = new Set([...allCss.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));

describe("nothing the screens read is left undefined", () => {
  it("defines every CSS variable read without a fallback", () => {
    const missing: string[] = [];
    for (const { path, text } of sources) {
      for (const match of text.matchAll(/var\((--[\w-]+)\s*\)/g)) {
        if (!definedVariables.has(match[1])) missing.push(`${path}: ${match[1]}`);
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("resolves every colour variable the screens use in both themes", () => {
    // Utility classes in the screens: solid colours (contrast is checked on them).
    const solid = new Set<string>();
    // The screens' own style sheets: any colour, overlays (rgb with alpha) included.
    const styled = new Set<string>();
    for (const { path, text } of sources) {
      if (path.endsWith(".tsx")) {
        for (const match of text.matchAll(/(?:text|bg|border|fill|stroke|outline|ring)-\[var\((--[\w-]+)\)\]/g)) {
          solid.add(match[1]);
        }
      }
      if (path.endsWith(".css") && !path.endsWith("tokens.css")) {
        const colourProperty = /(?:^|[;{\s])(color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke)\s*:([^;}]*)/g;
        for (const [, property, value] of text.matchAll(colourProperty)) {
          // In a border or outline shorthand the colour follows the line style; the width comes first.
          const shorthand = /^(border|outline)(-(top|right|bottom|left))?$/.test(property);
          const colourPart = shorthand ? (value.split(/\b(?:solid|dashed|dotted|double)\b/)[1] ?? "") : value;
          for (const match of colourPart.matchAll(/var\((--[\w-]+)\)/g)) styled.add(match[1]);
        }
      }
    }
    expect(solid.size).toBeGreaterThan(3);
    expect(styled.size).toBeGreaterThan(20);
    for (const theme of ["light", "dark"] as const) {
      for (const name of solid) {
        expect(() => colour(theme, name), `${name} (${theme})`).not.toThrow();
      }
      for (const name of styled) {
        const value = (() => {
          try {
            return resolve(theme, name).toLowerCase();
          } catch (error) {
            return String(error);
          }
        })();
        expect(value, `${name} (${theme})`).toMatch(/^(#[0-9a-f]{6}|rgba?\(.+\)|transparent)$/);
      }
    }
  });

  it("maps every theme colour utility the screens use", () => {
    const names = [
      "background", "foreground", "primary", "primary-foreground", "secondary", "secondary-foreground", "muted",
      "muted-foreground", "accent", "accent-foreground", "destructive", "card", "card-foreground", "popover",
      "popover-foreground", "border", "input", "ring", "surface", "surface-raised", "surface-interactive", "success",
      "warning", "danger", "focus",
    ];
    const pattern = new RegExp(`\\b(?:bg|text|border|ring|outline|fill|stroke|divide)-(${names.join("|")})(?=[\\s"'\`/:\\]]|$)`, "g");
    const missing = new Set<string>();
    for (const { text, path } of sources) {
      if (!path.endsWith(".tsx")) continue;
      for (const match of text.matchAll(pattern)) {
        if (!definedVariables.has(`--color-${match[1]}`)) missing.add(match[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

describe("type, spacing and sizes", () => {
  const rootDeclarations = lightDeclarations;

  it("declares the type scale with 16px body text", () => {
    expect(rootDeclarations).toMatchObject({
      "--type-technical": "13px",
      "--type-small": "14px",
      "--type-body": "16px",
      "--type-lead": "18px",
      "--type-title": "20px",
      "--type-heading": "24px",
      "--type-figure": "32px",
      "--type-display": "44px",
    });
    expect(indexCss).toMatch(/body\s*\{[^}]*font-size:\s*var\(--type-body\)/);
  });

  it("loads Public Sans for the interface and Bricolage Grotesque for figures, from the app itself", () => {
    expect(indexCss).toMatch(/@import\s+"@fontsource-variable\/public-sans"/);
    expect(indexCss).toMatch(/@import\s+"@fontsource-variable\/bricolage-grotesque"/);
    expect(allCss).toMatch(/--font-sans:\s*"Public Sans Variable"/);
    expect(allCss).toMatch(/--font-display:\s*"Bricolage Grotesque Variable"/);
    expect(allCss).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("declares spacing on a 4px base and the two radii", () => {
    expect(rootDeclarations).toMatchObject({
      "--space-1": "4px",
      "--space-2": "8px",
      "--space-4": "16px",
      "--radius-control": "6px",
      "--radius-card": "10px",
    });
  });

  it("declares the touch sizes", () => {
    expect(rootDeclarations).toMatchObject({
      "--target-min": "48px",
      "--target-frequent": "56px",
      "--target-money": "64px",
      "--tile-height": "88px",
      "--keypad-key": "72px",
      "--control-height": "var(--target-min)",
      "--control-height-compact": "var(--target-min)",
      "--topbar-height": "52px",
      "--rail-width": "76px",
    });
  });

  it("scales the compact and wide size classes without moving anything", () => {
    const compact = tokenBlocks.find((block) => block.atRule === "@media (max-width: 1279px)");
    const wide = tokenBlocks.find((block) => block.atRule === "@media (min-width: 1600px)");
    expect(compact?.declarations).toMatchObject({ "--keypad-key": "64px", "--rail-width": "64px" });
    const short = tokenBlocks.find((block) => block.atRule === "@media (max-height: 800px)");
    expect(short?.declarations).toMatchObject({ "--keypad-key": "64px" });
    expect(wide).toBeDefined();
  });

  it("shows a 3px focus ring in the action colour and respects reduced motion", () => {
    expect(indexCss).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/);
    expect(allCss).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps shadows to sheets and dialogs, with no glass or gradients", () => {
    expect(allCss).not.toMatch(/backdrop-filter\s*:/);
    expect(allCss).not.toMatch(/(?:linear|radial)-gradient\s*\(/);
    const shadows = [...stripComments(systemCss).matchAll(/box-shadow:\s*([^;]+);/g)].map((match) => match[1].trim());
    for (const shadow of shadows) {
      expect(shadow).toMatch(/^(none|var\(--shadow-sheet\)|inset .*)$/);
    }
  });

  it("enforces the minimum supported Tauri viewport", () => {
    expect(tauriConfig.app.windows[0]).toMatchObject({
      minWidth: 1024,
      minHeight: 768,
    });
  });

  it("names the window the way staff name it", () => {
    expect(tauriConfig.app.windows[0].title).toBe("Yetu till");
    expect(read("index.html")).toContain("<title>Yetu till</title>");
  });

  it("drops the old coloured bar down the side of the sign-in screens", () => {
    expect(indexCss).not.toMatch(/\.auth-shell::before/);
  });
});
