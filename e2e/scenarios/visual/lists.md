# Desktop list visual pilot

- **Spec**: [lists.spec.ts](../../visual/tests/lists.spec.ts)
- **Actors**: synthetic ordinary team member and administrator; no live accounts.
- **Owns**: isolated browser contexts and visual build/report directories. No server state.
- **Status**: canonical capture, two unchanged comparisons and deliberate-regression detection
  verified against v4.15.2; baselines approved by the repository owner on 2026-10-04.
  The Desktop visual CI job compares them on every PR and master push. See
  [validation and findings](../../visual/baseline-review.md).
- **Scope**: desktop web only. Fixed responses render the real SPA; these are visual tests,
  not evidence of backend authorization or end-to-end data correctness.
- **Capture**: desktop-width full-page images include every row vertically. Normal vertical
  scrolling is allowed; horizontal page overflow is not. Actions are scrolled into view to
  check reachability without requiring every row to fit on one screen.

## Scenario: member received feedback retains its desktop layout

1. As a member with no managed teams, open Received feedback at 1280px and 1440px.
   - *Expected*: Received is selected; only Received and Provided tabs appear; three supplied
     rows render, including long provider/requester names and sent multi-recipient feedback.
2. Inspect the complete desktop page against its approved image.
   - *Expected*: the page fits horizontally, row links remain visible, and the appearance matches.

## Scenario: member provided feedback retains its desktop actions and statuses

1. Open Provided feedback at 1280px and 1440px.
   - *Expected*: Provided is selected, with four supplied rows spanning Sent, Draft, Requested
     and Withdrawn, long recipient names and a multi-recipient sent item.
2. Inspect the complete desktop page against its approved image.
   - *Expected*: actions remain reachable, the page fits horizontally and the appearance matches.

## Scenario: all four dictionaries retain compact read-only desktop rows

1. As an ordinary member, open each of the four dictionaries at 1280px.
   - *Expected*: each page has four compact table rows, including long bilingual values and
     an English-only value. No editable text fields or Add entry button appear.
2. Compare each desktop page with its own approved image.
   - *Expected*: labels wrap within the page and the read-only layout matches.

## Scenario: administrator dictionary keeps its editable desktop rows

1. As an administrator, open Career paths at 1280px and 1440px.
   - *Expected*: populated English inputs and Add entry appear; Save is disabled before edits.
2. Compare each desktop page with its approved image without editing or saving.
   - *Expected*: input columns, row controls and footer retain their approved appearance.

## Scenario: Polish provided feedback keeps translated desktop labels contained

1. As a Polish-speaking member, open Provided feedback at 1280px.
   - *Expected*: Wystawione is selected, four rows appear, and only the two member tabs exist.
2. Compare the desktop page with its approved image.
   - *Expected*: translated labels and row actions fit and the appearance matches.

## Scenario: read-only dictionary retains its dark desktop appearance

1. Open Career paths as an ordinary member in dark mode at 1280px.
   - *Expected*: the dark scheme is active and four read-only rows render.
2. Compare the desktop page with its approved image.
   - *Expected*: the page fits and its dark colors, borders and spacing match.

## Acceptance outside the individual journeys

- No unhandled API calls, mutations, external network requests or uncaught application errors.
- Every capture waits for the expected content and bundled font.
- Approve initial images manually; never equate snapshot generation with design approval.
- Before activation, two unchanged canonical runs must pass and a deliberately clipped action
  or changed table spacing must produce a failure; revert the probe afterward.

## Not covered here

Mobile, real authentication, backend correctness, real data seeding, performance measurements,
cross-browser rendering, dictionary editing behavior, and semantic approval of a new design.
Functional journeys in the ordinary E2E suite retain their existing responsibilities.
