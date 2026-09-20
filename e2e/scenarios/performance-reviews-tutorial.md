# "How performance reviews work" tutorial — manager vs. non-manager walks

- **Spec**: [tests/performance-reviews-tutorial.spec.ts](../tests/performance-reviews-tutorial.spec.ts)
- **Actors**: Manager AAA (a manager), AAA One (a non-manager), ADMIN (precondition only) — seed
  accounts
- **Owns** (exclusive server-side state): nothing — read-only; precondition: at least one review
  period, appended by ADMIN only when the timeline is empty (a fresh database). The tutorial
  itself only navigates and spotlights stable chrome (tabs, header buttons, the Period/Team/view
  selects, the dashboard, the create form's fields and actions, the review page's lifecycle
  actions); it never clicks a spotlighted control or creates/edits a real review, so walking it
  mutates no server state. Safe under parallel workers — the parallel `performance-reviews.spec.ts`
  creates and mutates reviews as Manager AAA, but list totals are never compared here; the walker's
  own non-GET API traffic is recorded instead and asserted empty.
- **Since**: v3.17.0

## Scenario: the performance reviews tutorial walks a manager through 14 read-only steps and returns to the Performance page

1. As ADMIN, over the API, the spec checks whether any review period exists
   (`GET /api/v1/review-periods`). On the shared dev DB it always does, and this is a no-op; on a
   fresh database the spec signs in as ADMIN, opens Config → Review periods, and appends the
   previewed "Will add:" period exactly as `performance-reviews.spec.ts` does, then signs out.
2. Manager AAA signs in; the alert banner is collapsed first (a pre-existing active alert's
   expanded banner would overlay the header). They open the Performance page; from here on every
   non-GET API request the page issues is recorded, to prove afterward that nothing was written.
3. They click "How performance reviews work" in the page header and click "Next" through every
   step until "Done".
   - *Expected*: exactly 14 steps for a manager (intro, lifecycle, My performance, Filters,
     categories, Team's performance, the Period picker, the Table/Distribution/Quadrants views,
     the dashboard Filters, the New-review row action, the New-review form's fields, the form's
     actions, the review page's lifecycle actions, and Review periods).
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another: "nothing is saved" (intro) → "never skips Calibration" (the lifecycle step) → "My
     performance lists" (the own-reviews tab) → "Under Filters you narrow" (the own tab's
     Filters step) → "five categories" (the categories step) → "Team's performance shows" (the
     managed tab) → "Period picker" (the Period select) → "Distribution" (the views step) →
     "widens the scope" (the dashboard Filters step) → "New review in their row" (the New-review
     row action) → "Pick the team member" (the New-review form's fields) → "Create saves an empty
     draft" (the form's actions) → "Submit for calibration once" (the review page's lifecycle
     actions) → "Done takes you back to Performance" (the Review periods registry, the shared
     last step for both roles).
4. The tutorial finishes with "Done".
   - *Expected*: they land back on Performance, on the own-reviews tab (`/performance?tab=own`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — nothing was created, submitted, published, or deleted while looking around.

## Scenario: the performance reviews tutorial shows a non-manager 6 steps without the team steps

1. AAA One — a non-manager — signs in; the alert banner is collapsed first. They open the
   Performance page; from here on every non-GET API request the page issues is recorded. They
   click "How performance reviews work", then "Next" through every step until "Done".
   - *Expected*: exactly 6 steps — the eight manager-only steps (Team's performance, the Period
     picker, the views, the dashboard Filters, the New-review row action, the New-review form's
     fields and actions, and the review page's lifecycle actions) are absent, and no step's text
     mentions "Team's performance shows", "New review in their row", or "Submit for calibration
     once".
2. The tutorial finishes with "Done".
   - *Expected*: they land back on Performance, on the own-reviews tab (`/performance?tab=own`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — the non-manager walk is read-only too.
