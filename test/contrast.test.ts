import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AA_LARGE,
  AA_NORMAL,
  blendOver,
  contrastRatio,
  formatRatio,
  meetsAa,
  parseRgbTriple,
  relativeLuminance,
  type Rgb,
} from "@/lib/contrast";

/**
 * The contrast audit is a test, not a review comment.
 *
 * `globals.css` is the only place a colour is defined, so the palettes are read
 * out of it here rather than copied into TypeScript where they could drift.
 * Every pairing below is one the components actually paint — body text on each
 * surface, status text inside its own tint, and the focus ring — so a palette
 * edit that makes something unreadable fails CI instead of a reader's eyes.
 */

const STYLESHEET = readFileSync("src/app/globals.css", "utf8");

/** The declarations of the first block opened by `selector`. */
function declarations(selector: string): Map<string, Rgb> {
  const at = STYLESHEET.indexOf(selector);
  expect(at, `globals.css has no \`${selector}\` block`).toBeGreaterThan(-1);

  const open = STYLESHEET.indexOf("{", at);
  const close = STYLESHEET.indexOf("}", open);
  expect(open, `\`${selector}\` does not open a block`).toBeGreaterThan(-1);
  expect(close, `\`${selector}\` does not close its block`).toBeGreaterThan(open);

  const body = STYLESHEET.slice(open + 1, close);
  const tokens = new Map<string, Rgb>();

  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (!name || !value) continue;

    const rgb = parseRgbTriple(value);
    expect(rgb, `--${name} is not three 0-255 channels: \`${value.trim()}\``).not.toBeNull();
    if (rgb) tokens.set(name, rgb);
  }

  return tokens;
}

const LIGHT = declarations(":root {");
/** A dark OS with no stored choice: the media query palettes. */
const DARK_SYSTEM = new Map([...LIGHT, ...declarations(':root:not([data-theme="light"])')]);
/** `data-theme="dark"` written before first paint by the inline script. */
const DARK_CHOSEN = new Map([...LIGHT, ...declarations(':root[data-theme="dark"]')]);

const THEMES: ReadonlyArray<{ name: string; tokens: Map<string, Rgb> }> = [
  { name: "light", tokens: LIGHT },
  { name: "dark (system preference)", tokens: DARK_SYSTEM },
  { name: "dark (stored choice)", tokens: DARK_CHOSEN },
];

/** Text tokens: everything the app uses as a `text-*` colour. */
const TEXT_TOKENS = ["fg", "soft", "muted", "accent", "danger", "warn", "info"] as const;
/** Surfaces those tokens are painted on: the page and a panel on top of it. */
const SURFACES = ["ink", "panel"] as const;
/** Status colours that tint a panel behind text of their own colour. */
const STATUS_TOKENS = ["accent", "danger", "warn", "info"] as const;

const WHITE: Rgb = [255, 255, 255];

function token(tokens: Map<string, Rgb>, name: string): Rgb {
  const value = tokens.get(name);
  if (!value) throw new Error(`the palette does not define --${name}`);
  return value;
}

describe("WCAG maths", () => {
  it("reads the stylesheet's space-separated channels", () => {
    expect(parseRgbTriple("15 23 42")).toEqual([15, 23, 42]);
    expect(parseRgbTriple("  6   118 71 ")).toEqual([6, 118, 71]);
  });

  it("rejects anything that is not three channels in range", () => {
    expect(parseRgbTriple("")).toBeNull();
    expect(parseRgbTriple("15 23")).toBeNull();
    expect(parseRgbTriple("15 23 42 1")).toBeNull();
    expect(parseRgbTriple("15 23 256")).toBeNull();
    expect(parseRgbTriple("15 23 -1")).toBeNull();
    expect(parseRgbTriple("15 23 rgb")).toBeNull();
  });

  it("uses the documented luminance endpoints", () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
    expect(contrastRatio([0, 0, 0], WHITE)).toBeCloseTo(21, 10);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 10);
    // Symmetric: the order of the pair must not matter.
    expect(contrastRatio([15, 23, 42], WHITE)).toBeCloseTo(
      contrastRatio(WHITE, [15, 23, 42]),
      10,
    );
  });

  it("applies the AA thresholds", () => {
    expect(meetsAa(4.5)).toBe(true);
    expect(meetsAa(4.49)).toBe(false);
    expect(meetsAa(3, "large")).toBe(true);
    expect(meetsAa(2.99, "large")).toBe(false);
    expect(AA_NORMAL).toBe(4.5);
    expect(AA_LARGE).toBe(3);
  });

  it("composites a translucent tint over the surface it lands on", () => {
    expect(blendOver(WHITE, [0, 0, 0], 0.5)).toEqual([128, 128, 128]);
    expect(blendOver([0, 0, 0], WHITE, 0)).toEqual(WHITE);
    expect(blendOver([0, 0, 0], WHITE, 1)).toEqual([0, 0, 0]);
    // Out-of-range alpha is clamped rather than extrapolated.
    expect(blendOver([0, 0, 0], WHITE, -1)).toEqual(WHITE);
    expect(blendOver([0, 0, 0], WHITE, 2)).toEqual([0, 0, 0]);
  });

  it("formats a ratio for a failure message", () => {
    expect(formatRatio(4.6123)).toBe("4.61:1");
    expect(formatRatio(21)).toBe("21.00:1");
  });
});

describe.each(THEMES)("$name palette", ({ tokens }) => {
  it("defines every colour the components paint with", () => {
    for (const name of [...TEXT_TOKENS, ...SURFACES]) {
      expect(tokens.has(name), `--${name} is missing`).toBe(true);
    }
  });

  it("paints every text token at AA on both surfaces", () => {
    for (const text of TEXT_TOKENS) {
      for (const surface of SURFACES) {
        const ratio = contrastRatio(token(tokens, text), token(tokens, surface));
        expect(
          ratio,
          `--${text} on --${surface} is ${formatRatio(ratio)}, below AA ${AA_NORMAL}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    }
  });

  it("keeps status text legible inside its own tint", () => {
    for (const status of STATUS_TOKENS) {
      for (const alpha of [0.1, 0.15]) {
        const background = blendOver(token(tokens, status), token(tokens, "panel"), alpha);
        const ratio = contrastRatio(token(tokens, status), background);
        expect(
          ratio,
          `--${status} on its ${Math.round(alpha * 100)}% tint is ${formatRatio(ratio)}`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    }
  });

  it("keeps the neutral badge readable", () => {
    const background = blendOver(token(tokens, "fg"), token(tokens, "panel"), 0.1);
    const ratio = contrastRatio(token(tokens, "soft"), background);
    expect(ratio, `--soft on the --fg/10 badge is ${formatRatio(ratio)}`).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });

  it("keeps the focus ring visible on both surfaces at 3:1", () => {
    for (const surface of SURFACES) {
      const ring = blendOver(token(tokens, "accent"), token(tokens, surface), 0.7);
      const ratio = contrastRatio(ring, token(tokens, surface));
      expect(
        ratio,
        `the accent/70 focus ring on --${surface} is ${formatRatio(ratio)}, below ${AA_LARGE}:1`,
      ).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  it("keeps white button text legible on the destructive fill", () => {
    for (const fill of ["danger-solid", "danger-solid-hover"] as const) {
      const ratio = contrastRatio(WHITE, token(tokens, fill));
      expect(
        ratio,
        `white on --${fill} is ${formatRatio(ratio)}, below AA ${AA_NORMAL}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it("keeps primary button text legible on the accent fill", () => {
    const ratio = contrastRatio(token(tokens, "ink"), token(tokens, "accent"));
    expect(
      ratio,
      `text-ink on the accent fill is ${formatRatio(ratio)}, below AA ${AA_NORMAL}:1`,
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

/**
 * A fixed Tailwind palette colour stops following the theme: `text-slate-200`
 * is near-white in light mode and `text-amber-300` is near-invisible on a white
 * panel, which is what this guard was written after. Everything readable must
 * come from the tokens above. `print:` variants are exempt — printing is always
 * black on white, which is exactly what those classes are for.
 */
describe("theme tokens instead of fixed palette colours", () => {
  const PALETTE_UTILITY =
    /\b(?:text|bg|border|ring|divide|fill|stroke)-(?:slate|gray|zinc|neutral|stone|amber|rose|emerald|green|red|yellow|orange|sky)-(\d{2,3})\b/;
  const PRINT_ONLY = /print:[^\s"'`]+/g;

  function walk(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...walk(path));
      else files.push(path);
    }
    return files;
  }

  it("never paints a themeable element with a fixed palette colour", () => {
    const offenders: string[] = [];

    for (const file of walk("src")) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const onScreen = line.replace(PRINT_ONLY, "");
        if (PALETTE_UTILITY.test(onScreen)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      "these classes ignore the light/dark tokens; use fg, soft, muted, accent, danger, warn, info, edge or a tint of them",
    ).toEqual([]);
  });
});
