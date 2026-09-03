import type { CSSVariablesResolver } from "@mantine/core";

/**
 * The colour tokens the v3.3.0 design pass owns outside Mantine's defaults — every value here
 * is chosen for WCAG AA (≥ 4.5:1) on the surface it sits on, in BOTH schemes, and
 * `theme.test.ts` guards the ratios. Mantine's stock light-variant inks are the hue's 6-shade
 * (teal 2.3:1, orange 2.3, red 2.9, yellow 1.7 on their tints) and its `dimmed` is gray-6
 * (3.3:1) — the reason the axe colour-contrast rule used to be waived.
 *
 * Callers: never hand a shade-suffixed colour (`"orange.8"`) to a `variant="light"` Badge or
 * Alert — the tint comes from the hue, the ink comes from this map.
 */
export const LIGHT_TOKENS = {
  text: "#1f2328",
  dimmed: "#5f6b76",
  canvas: "#f8f9fb",
  border: "#dee2e6",
  borderStrong: "#ced4da",
  error: "#c92a2a",
  inkWarning: "#b23a0a",
  inkError: "#c92a2a",
} as const;

export const DARK_TOKENS = {
  text: "#e6e6e6",
  dimmed: "#a3a3a3",
  canvas: "#1f1f1f",
  border: "#424242",
  borderStrong: "#696969",
  error: "#ff8787",
  inkWarning: "#ffc078",
  inkError: "#ff8787",
} as const;

/** Light-scheme inks for `variant="light"` surfaces, per hue (the dark scheme keeps Mantine's
 *  own 3/4-shades, which already clear 6:1 on their tints). */
export const LIGHT_VARIANT_INKS = {
  lettuce: "#166534",
  teal: "#087255",
  orange: "#b23a0a",
  red: "#b91c1c",
  yellow: "#8a4800",
  gray: "#495057",
  blue: "#1864ab",
  grape: "#862e9c",
  cyan: "#0b7285",
  indigo: "#364fc7",
  green: "#236b34",
  violet: "#5f3dc4",
  pink: "#a61e4d",
  lime: "#3f6a05",
} as const;

function schemeVariables(tokens: typeof LIGHT_TOKENS | typeof DARK_TOKENS): Record<string, string> {
  return {
    "--mantine-color-text": tokens.text,
    "--mantine-color-dimmed": tokens.dimmed,
    "--lettuce-canvas": tokens.canvas,
    "--mantine-color-default-border": tokens.border,
    "--lettuce-border-strong": tokens.borderStrong,
    "--mantine-color-error": tokens.error,
    "--lettuce-ink-warning": tokens.inkWarning,
    "--lettuce-ink-error": tokens.inkError,
  };
}

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    ...schemeVariables(LIGHT_TOKENS),
    ...Object.fromEntries(
      Object.entries(LIGHT_VARIANT_INKS).map(([hue, ink]) => [`--mantine-color-${hue}-light-color`, ink]),
    ),
  },
  dark: schemeVariables(DARK_TOKENS),
});
