import { DEFAULT_THEME } from "@mantine/core";
import { describe, expect, it } from "vitest";
import { DARK_TOKENS, LIGHT_TOKENS, LIGHT_VARIANT_INKS } from "./themeVariables";

// WCAG 2.x relative luminance + contrast ratio — the guard that keeps the v3.3.0 colour
// tokens AA-clean (the e2e axe scan runs the color-contrast rule un-waived since then).
function channel(hex: string, offset: number): number {
  const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** A translucent colour composited over an opaque ground (Mantine's light-variant tint is the
 *  hue's 6-shade at 10% over the surface). */
function blend(fg: string, alpha: number, bg: string): string {
  const mix = (offset: number) => {
    const f = Number.parseInt(fg.slice(offset, offset + 2), 16);
    const b = Number.parseInt(bg.slice(offset, offset + 2), 16);
    return Math.round(f * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

const WHITE = "#ffffff";
const LETTUCE_6 = "#16a34a";
const AA = 4.5;

describe("theme colour tokens (WCAG AA)", () => {
  it("light text tokens clear 4.5:1 on white and on the canvas", () => {
    for (const ink of [LIGHT_TOKENS.text, LIGHT_TOKENS.dimmed, LIGHT_TOKENS.error, LIGHT_TOKENS.inkWarning, LIGHT_TOKENS.inkError]) {
      expect(contrast(ink, WHITE), `${ink} on white`).toBeGreaterThanOrEqual(AA);
      expect(contrast(ink, LIGHT_TOKENS.canvas), `${ink} on canvas`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("every light-variant ink clears 4.5:1 on its hue tint", () => {
    for (const [hue, ink] of Object.entries(LIGHT_VARIANT_INKS)) {
      const base = hue === "lettuce" ? LETTUCE_6 : DEFAULT_THEME.colors[hue][6];
      expect(base, `unknown hue ${hue}`).toBeDefined();
      const tint = blend(base, 0.1, WHITE);
      expect(contrast(ink, tint), `${hue} ink ${ink} on tint ${tint}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("dark text tokens clear 4.5:1 on the dark surfaces", () => {
    const surfaces = [DEFAULT_THEME.colors.dark[7], DEFAULT_THEME.colors.dark[6], DARK_TOKENS.canvas];
    for (const ink of [DARK_TOKENS.text, DARK_TOKENS.dimmed, DARK_TOKENS.error, DARK_TOKENS.inkWarning, DARK_TOKENS.inkError]) {
      for (const surface of surfaces) {
        expect(contrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it("the brand accent (primary shade 7) stays usable as a focus ring and filled button", () => {
    // 3:1 is the non-text (UI component) floor; white text on the filled button needs 4.5:1.
    expect(contrast("#15803d", WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#15803d", LIGHT_TOKENS.canvas)).toBeGreaterThanOrEqual(3);
  });
});
