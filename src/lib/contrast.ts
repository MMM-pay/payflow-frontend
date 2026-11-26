/**
 * WCAG 2.2 contrast maths for the two palettes in `globals.css`.
 *
 * Every colour the app paints comes from a CSS custom property in that
 * stylesheet, so a token that is too light or too dark is the one contrast
 * failure a check can catch without a browser. `test/contrast.test.ts` reads
 * the channels out of the stylesheet — the stylesheet stays the single source
 * of truth — and asserts every text/surface pairing the components actually use
 * against the AA thresholds below.
 *
 * The channel maths is separated from the palette so it can be tested directly:
 * a ratio is a number with a documented definition, not a screenshot.
 */

/** A colour as 8-bit sRGB channels, the units `globals.css` stores. */
export type Rgb = readonly [number, number, number];

/** AA for normal-size text: below 18pt, or below 14pt bold. */
export const AA_NORMAL = 4.5;

/** AA for large text, and for non-text UI such as focus rings and icons. */
export const AA_LARGE = 3;

/**
 * Read a `--token: 15 23 42` value into channels.
 *
 * Returns null for anything that is not three integers in 0–255: a malformed
 * token is a stylesheet bug the caller should report, not a colour to compare
 * as if it were black.
 */
export function parseRgbTriple(value: string): Rgb | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3) return null;

  const channels: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const channel = Number(part);
    if (channel > 255) return null;
    channels.push(channel);
  }

  const [r, g, b] = channels;
  if (r === undefined || g === undefined || b === undefined) return null;
  return [r, g, b];
}

/** WCAG relative luminance of one sRGB channel, in [0, 1]. */
function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour, in [0, 1]. */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2])
  );
}

/** The contrast ratio between two opaque colours: 1 (identical) to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Whether a ratio clears the given AA level. */
export function meetsAa(ratio: number, level: "normal" | "large" = "normal"): boolean {
  return ratio >= (level === "normal" ? AA_NORMAL : AA_LARGE);
}

/**
 * Composite a translucent colour over an opaque one.
 *
 * Tailwind's `/10` and `/15` modifiers are how the badges and notices tint a
 * panel with a status colour while the text inside keeps that same status
 * colour. The two have to be measured as they land on screen — a tint that
 * moves the background toward the foreground can fail even though each token
 * reads fine on the panel by itself.
 *
 * Alpha is clamped to [0, 1] and the result is rounded to the channel values a
 * browser composites to.
 */
export function blendOver(top: Rgb, bottom: Rgb, alpha: number): Rgb {
  const ratio = Math.min(1, Math.max(0, alpha));
  const mix = (topChannel: number, bottomChannel: number) =>
    Math.round(topChannel * ratio + bottomChannel * (1 - ratio));
  return [
    mix(top[0], bottom[0]),
    mix(top[1], bottom[1]),
    mix(top[2], bottom[2]),
  ];
}

/** A ratio as it should read in a failure message: `4.61:1`. */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}
