import { DEFAULT_THEME } from "@mantine/core";
import { describe, expect, it } from "vitest";
import indexCss from "./index.css?raw";
import { theme } from "./theme";
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
// Mantine's own `darken(color, alpha)`: each channel scaled by (1 - alpha), rounded — the dark
// scheme's light-variant surface is `darken(<hue>-9, 0.5)` (get-css-color-variables.mjs).
function darken(hex: string, alpha: number): string {
  const scaled = [1, 3, 5].map((o) => Math.round(Number.parseInt(hex.slice(o, o + 2), 16) * (1 - alpha)));
  return `#${scaled.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
const WHITE = "#ffffff";
// Mantine 9 paints a light-variant surface with the hue's SOLID 1-shade in the light scheme
// (`--mantine-color-<hue>-light: var(--mantine-color-<hue>-1)`) — the ink must clear AA on it.
const LETTUCE_1 = "#dcfce7";
// The dark-scheme body colour (`--mantine-color-body` = dark-7).
const DARK_BODY = DEFAULT_THEME.colors.dark[7];
const AA = 4.5;

describe("theme colour tokens (WCAG AA)", () => {
  it("light text tokens clear 4.5:1 on white, the canvas, and the surface tint", () => {
    // The surface tint is the FilterPanelBody ground (v3.5.2) — dimmed labels sit on it.
    const surfaces = [WHITE, LIGHT_TOKENS.canvas, LIGHT_TOKENS.surfaceTint];
    for (const ink of [LIGHT_TOKENS.text, LIGHT_TOKENS.dimmed, LIGHT_TOKENS.error, LIGHT_TOKENS.inkWarning, LIGHT_TOKENS.inkError]) {
      for (const surface of surfaces) {
        expect(contrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(AA);
      }
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

  it("the dark scheme keeps Mantine's own light-variant pairs (0-shade over a darkened 9-shade)", () => {
    for (const hue of Object.keys(LIGHT_VARIANT_INKS)) {
      const scale = hue === "lettuce" ? theme.colors!.lettuce! : DEFAULT_THEME.colors[hue];
      expect(contrast(scale[0], darken(scale[9], 0.5)), `${hue} dark light-variant`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("the alerts banner pairs clear 4.5:1 in both schemes (surface↔ink, chip bg↔chip ink)", () => {
    // AlertsBanner (v3.5.2): `variant="light" color="orange"` — surface = orange-1 / darken(orange-9, .5),
    // ink = `--mantine-color-orange-light-color` (the light token / orange-0); the title chip
    // inverts the pair with the scheme's body colour as its text.
    const orange = DEFAULT_THEME.colors.orange;
    const light = { surface: orange[1], ink: LIGHT_VARIANT_INKS.orange, chipInk: WHITE };
    const dark = { surface: darken(orange[9], 0.5), ink: orange[0], chipInk: DARK_BODY };
    for (const [scheme, pair] of Object.entries({ light, dark })) {
      expect(contrast(pair.ink, pair.surface), `${scheme} banner ink on surface`).toBeGreaterThanOrEqual(AA);
      expect(contrast(pair.chipInk, pair.ink), `${scheme} chip text on chip fill`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("dark text tokens clear 4.5:1 on the dark surfaces", () => {
    // dark-7 = body, dark-6 = table heads, the canvas, and the surface tint (FilterPanelBody).
    const surfaces = [DEFAULT_THEME.colors.dark[7], DEFAULT_THEME.colors.dark[6], DARK_TOKENS.canvas, DARK_TOKENS.surfaceTint];
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

  it("index.css paints the first-paint canvas with the same hexes as the canvas tokens", () => {
    // The bundle's CSS variables don't exist before Mantine mounts, so index.css repeats the
    // two canvas hexes literally — keep them in lockstep with themeVariables.ts.
    const match = /background-color:\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/i.exec(indexCss);
    expect(match, "index.css first-paint canvas rule").not.toBeNull();
    expect(match![1]).toBe(LIGHT_TOKENS.canvas);
    expect(match![2]).toBe(DARK_TOKENS.canvas);
  });
});

describe("theme component defaults", () => {
  it("registers the drawer overlay dim/blur on DrawerOverlay, where both Drawer shapes read it", () => {
    // `Drawer.Root` reads "DrawerRoot" defaults, never the "Drawer" entry — an overlayProps
    // default there silently skipped the compound notifications panel (v3.5.2).
    expect(theme.components!.DrawerOverlay!.defaultProps).toEqual({ backgroundOpacity: 0.45, blur: 2 });
    expect(theme.components!.Drawer!.defaultProps).not.toHaveProperty("overlayProps");
  });
});
