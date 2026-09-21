# "How team KPIs work" tutorial — manager vs. team-member walks

- **Spec**: [tests/team-kpis-tutorial.spec.ts](../tests/team-kpis-tutorial.spec.ts)
- **Actors**: Manager AAA (a manager), AAA One (a team member, not a manager) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only. The tutorial only navigates and
  spotlights stable chrome (tabs, the Filters panels, the KPI data/Graph tab explanations, the New
  team KPI button and form's definition fields and footer actions, the KPI lifecycle actions, and
  the dashboard's My teams tab); it never clicks a spotlighted control or creates/edits a real KPI
  or value, so walking it mutates no server state. Safe under parallel workers — the parallel
  `team-kpis.spec.ts` creates and edits KPIs as Manager AAA and records values as AAA One, but list
  totals are never compared here; the walker's own non-GET API traffic is recorded instead and
  asserted empty.
- **Since**: v3.20.0

## Scenario: the team KPIs tutorial walks a manager through 14 read-only steps and returns to the Team KPIs page

1. Manager AAA signs in; the alert banner is collapsed first (a pre-existing active alert's
   expanded banner would overlay the header). They open the Team KPIs page; from here on every
   non-GET API request the page issues is recorded, to prove afterward that nothing was written.
2. They click "How team KPIs work" in the page header and click "Next" through every step until
   "Done".
   - *Expected*: exactly 14 steps for a manager (intro, the lifecycle diagram, My teams' KPIs, its
     Filters, the KPI data tab, the Graph tab, Managed KPIs, its Filters with the Reports scope,
     the New-KPI action, the form's definition fields, the form's footer actions, the KPI page's
     lifecycle actions, the dashboard's My teams KPI button, and the closing step).
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another: "nothing is saved" (intro) → "starts as a Draft" (the lifecycle diagram step) →
     "My teams' KPIs lists" (the own tab) → "Under Filters you narrow" (the own tab's Filters
     step) → "KPI data tab" (the KPI-data explanation step) → "The Graph tab plots" (the Graph
     explanation step) → "Managed KPIs lists" (the managed tab) → "Here Filters add the Reports
     scope" (the managed tab's Filters step) → "A new team KPI starts here" (the New-KPI step) →
     "Pick the team" (the form's definition-fields step) → "Create saves the KPI" (the form's
     footer-actions step) → "drives the lifecycle" (the KPI page's lifecycle-actions step) →
     "Each team on My teams" (the dashboard's My teams KPI-button step) → "Done takes you back to
     Team KPIs" (the closing step, the shared last step for both roles).
3. The tutorial finishes with "Done".
   - *Expected*: they land back on the Team KPIs page, on the own-KPIs tab (`/team-kpis?tab=own`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — nothing was created, edited, or deleted while looking around.

## Scenario: the team KPIs tutorial shows a team member 7 steps without the manager steps

1. AAA One — a team member of team AAA, not a manager — signs in; the alert banner is collapsed
   first. They open the Team KPIs page; from here on every non-GET API request the page issues is
   recorded. They click "How team KPIs work", then "Next" through every step until "Done".
   - *Expected*: exactly 7 steps — the manager-only steps (Managed KPIs and its Filters, the
     New-KPI action, the form's definition fields and footer actions, the KPI page's lifecycle
     actions, and the dashboard's My teams KPI button) are absent, and no step's text mentions
     "Managed KPIs lists", "A new team KPI starts here", or "drives the lifecycle".
2. The tutorial finishes with "Done".
   - *Expected*: they land back on the Team KPIs page, on the own-KPIs tab (`/team-kpis?tab=own`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — the team-member walk is read-only too.
