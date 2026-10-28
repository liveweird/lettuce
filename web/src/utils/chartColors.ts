/**
 * Chart series colours for the telemetry panel's trends (the app's other chart, `TeamKpiChart`, is one brand-coloured line, so a
 * categorical palette is defined here once and every later multi-line chart draws from it).
 *
 * The app's colour vocabulary reserves the brand green (`lettuce`: interactive), teal (success), red (error) and orange (soft
 * warning), so a series - which is an arbitrary NAME, a metric or a table - wears none of them. What is left is the seven
 * Mantine hues below; each entry is the ONE shade of its hue that clears WCAG 1.4.11 (3:1) on every surface a chart sits on -
 * white and the `#f8f9fb` canvas in the light scheme, the body and canvas greys (`#242424`, `#1f1f1f`) in the dark one - so there
 * is no per-scheme pair. The ORDER is the colour-blind-safety mechanism. Re-validated for Lettuce's surfaces (v4.20.0) with the
 * dataviz skill's `validate_palette.js` on all four: every gate passes on the adjacent pairlist (worst adjacent CVD ΔE 14.1,
 * worst adjacent normal-vision ΔE 16.1). `lime.9` (an olive, #5c940d) was the one candidate for a swap as green-adjacent to the
 * brand green; its only validated replacement, `yellow.9`, fails the dark-mode lightness band and is below 3:1 on the light
 * canvas, so it stays - the olive sits at hue ~85 degrees against the brand's ~145 and never sits beside the green UI accents
 * inside a chart. Lines take their colour by position, in this order. A chart never draws more lines than there are colours
 * (`TelemetryTrend` plots the first seven columns; the rest stay in the table), so the order is never cycled.
 * `chartColors.test.ts` recomputes the contrast and the CIEDE2000 distance between NEIGHBOURS (dataviz floor >= 15) from the theme.
 *
 * Colour is never the only carrier of identity: a chart with two or more lines also has a legend, a tooltip naming each line
 * and a table of the numbers, and every line after the first wears its own dash pattern (`LINE_DASHES`).
 */
export const CATEGORY_PALETTE: ReadonlyArray<string> = [
  "blue.7",
  "lime.9",
  "violet.5",
  "cyan.7",
  "indigo.5",
  "pink.6",
  "grape.6",
];

/**
 * The secondary encoding of the Nth line: solid first, then dashes that tell the lines apart without colour (the legend swatch
 * keeps its colour; the stroke pattern is what a colour-blind reader or a greyscale print can follow).
 */
export const LINE_DASHES: ReadonlyArray<string | undefined> = [
  undefined,
  "6 3",
  "2 3",
  "9 3 2 3",
  "1 4",
  "12 4",
  "5 2 1 2",
];

/** The colour and dash pattern of the `index`-th line of a chart. */
export function lineStyle(index: number): { color: string; strokeDasharray: string | undefined } {
  return {
    color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] ?? "gray.6",
    strokeDasharray: LINE_DASHES[index % LINE_DASHES.length],
  };
}
