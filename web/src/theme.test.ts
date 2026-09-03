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
const WHITE = "#ffffff";
// Mantine 9 paints a light-variant surface with the hue's SOLID 1-shade in the light scheme
// (`--mantine-color-<hue>-light: var(--mantine-color-<hue>-1)`) — the ink must clear AA on it.
const LETTUCE_1 = "#dcfce7";
const AA = 4.5;

describe("theme colour tokens (WCAG AA)", () => {
  it("light text tokens clear 4.5:1 on white and on the canvas", () => {
    for (const ink of [LIGHT_TOKENS.text, LIGHT_TOKENS.dimmed, LIGHT_TOKENS.error, LIGHT_TOKENS.inkWarning, LIGHT_TOKENS.inkError]) {
      expect(contrast(ink, WHITE), `${ink} on white`).toBeGreaterThanOrEqual(AA);
      expect(contrast(ink, LIGHT_TOKENS.canvas), `${ink} on canvas`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("every light-variant ink clears 4.5:1 on its hue's light surface (the 1-shade)", () => {
    for (const [hue, ink] of Object.entries(LIGHT_VARIANT_INKS)) {
      const surface = hue === "lettuce" ? LETTUCE_1 : DEFAULT_THEME.colors[hue][1];
      expect(surface, `unknown hue ${hue}`).toBeDefined();
      expect(contrast(ink, surface), `${hue} ink ${ink} on ${surface}`).toBeGreaterThanOrEqual(AA);
      // The same ink also sits on white/canvas surfaces (links, filled-on-light text).
      expect(contrast(ink, WHITE), `${hue} ink ${ink} on white`).toBeGreaterThanOrEqual(AA);
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
