import { describe, expect, it } from "vitest";

// The density presets are container-query thresholds, nothing else: below them a ResponsiveTable
// stops being a table and becomes stacked label/value cards (ResponsiveTable.module.css —
// `compact` 40rem, `normal` 56rem, `wide` 68rem/1088px). So a density is only correct relative to
// the width its table ACTUALLY gets, and the form/detail shells cap that width: the two page
// tiers are `Container size="sm"` and `size="md"` (web/CLAUDE.md, v1.35.1), the widest of which
// is 960px BEFORE the card's own padding. A `wide` table inside one can therefore never un-stack,
// at any viewport — which is exactly how v3.4.0 shipped ViewOneOnOne and ImportUsers with
// permanently stacked tables (v3.25.2). The regression is invisible to DOM assertions, since a
// stacked row still contains every cell, so it is pinned here at the source level instead.
//
// This matches on file-level CO-OCCURRENCE, which is a heuristic with two known limits. It can
// false-POSITIVE on a page that holds a capped container in one branch and a full-width table in
// another; narrow the rule rather than deleting it if such a page ever appears. And it is blind
// ACROSS files: the standalone table components (DaysOffBudgetsTable and friends) declare their
// density in their own file, so a future page that wrapped one of them in a capped Container
// would not be caught here — every consumer of those components is a full-width hub or drill-down
// shell today, which is why the rule holds. Both limits are accepted: the check costs nothing at
// runtime and covers every page that declares its own table, including ones the Playwright layout
// specs never reach. Closing the cross-file gap would mean resolving each component's density
// through its props rather than grepping source — worth doing only once something needs it.
const SOURCES = import.meta.glob("../**/*.tsx", { eager: true, query: "?raw", import: "default" });

const CAPPED_CONTAINER = /<Container\b[^>]*\bsize="(sm|md)"/;
const WIDE_DENSITY = /<ResponsiveTable\b[^>]*\bdensity="wide"/;

describe("ResponsiveTable density vs. the page shell it sits in", () => {
  it("never declares a wide table inside an sm/md form or detail container", () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !path.includes(".test."))
      .filter(([, source]) => {
        const text = source as string;
        return CAPPED_CONTAINER.test(text) && WIDE_DENSITY.test(text);
      })
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("scans the real page sources", () => {
    // A broken glob would make the check above vacuously pass forever.
    const paths = Object.keys(SOURCES);
    expect(paths.length).toBeGreaterThan(50);
    expect(paths.some((p) => p.endsWith("/pages/ViewOneOnOne.tsx"))).toBe(true);
  });
});
