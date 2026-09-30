import type { CSSVariablesResolver } from "@mantine/core";

/**
 * The colour tokens the shared design system owns outside Mantine's defaults — every value here
 * is chosen for WCAG AA (≥ 4.5:1) on the surface it sits on, in BOTH schemes, and
 * `theme.test.ts` guards the ratios. Mantine 9.5's stock light-variant ink in the LIGHT scheme
 * is the hue's 9-shade over the solid 1-shade tint (orange 3.6:1, green 3.8, teal 4.3, yellow
 * 2.7 — see `get-css-color-variables.mjs`), and its `dimmed` is gray-6 (3.3:1) — the reason
 * the axe colour-contrast rule used to be waived. In the DARK scheme Mantine paints the
 * 0-shade over a 50%-darkened 9-shade, which clears 8:1 for every hue, so only the light
 * inks are overridden below.
 *
 * Callers: never hand a shade-suffixed colour (`"orange.8"`) to a `variant="light"` Badge or
 * Alert — the tint comes from the hue, the ink comes from this map.
 */
export const LIGHT_TOKENS = {
  text: "#202b27",
  dimmed: "#63706a",
  canvas: "#ffffff",
  chrome: "#f3f5f4",
  surface: "#ffffff",
  // A restrained inset surface for filter rows and secondary card sections.
  surfaceTint: "#f8faf9",
  border: "#dce3df",
  borderStrong: "#b8c5be",
  error: "#c92a2a",
  inkWarning: "#b23a0a",
  inkError: "#c92a2a",
} as const;

export const DARK_TOKENS = {
  text: "#edf3ef",
  dimmed: "#aebbb4",
  canvas: "#171c19",
  chrome: "#1d2521",
  surface: "#202824",
  surfaceTint: "#27312c",
  border: "#3b4942",
  borderStrong: "#64736b",
  error: "#ff8787",
  inkWarning: "#ffc078",
  inkError: "#ff8787",
} as const;

/** Light-scheme inks for `variant="light"` surfaces, per hue — each replaces the stock 9-shade
 *  ink on the hue's solid 1-shade tint. The dark scheme keeps Mantine's own values (the
 *  0-shade over a 50%-darkened 9-shade, ≥ 8:1 for every hue — guarded in theme.test.ts). */
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
    "--lettuce-chrome": tokens.chrome,
    "--lettuce-surface": tokens.surface,
    "--lettuce-surface-tint": tokens.surfaceTint,
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
