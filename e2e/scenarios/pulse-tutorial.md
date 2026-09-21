# "How pulse surveys work" tutorial — admin, manager, and team-member walks

- **Spec**: [tests/pulse-tutorial.spec.ts](../tests/pulse-tutorial.spec.ts)
- **Actors**: Admin (the seed administrator), Manager AAA (a manager), AAA One (a team member,
  not a manager) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only. The tutorial only navigates and
  spotlights stable chrome (the four hub tabs, the Current-survey/Results/Trend/Participation
  explanations, and — for an admin — the Pulse cycles registry page's Settings card, New-cycle
  card, and cycle table); it never opens a real survey, cycle, or result, and never creates,
  edits, or cancels a cycle, so walking it mutates no server state. Safe under parallel workers
  and immune to `pulse.spec.ts`'s own serial-phase cycle lifecycle (its own chained project, after
  `alerts.spec.ts`) — this spec reads no cycle-dependent DOM and compares no totals, so a cycle
  being scheduled, opened, or closed elsewhere never changes what it sees. The walker's own
  non-GET API traffic is recorded instead and asserted empty.
- **Since**: v3.21.0

## Scenario: the pulse surveys tutorial walks an admin through the cycle-management steps and returns to the Pulse surveys page

1. Admin signs in; the alert banner is collapsed first (a pre-existing active alert's expanded
   banner would overlay the header). They open the Pulse surveys page; from here on every non-GET
   API request the page issues is recorded, to prove afterward that nothing was written.
   - Before walking, the expected step count is derived from whether the admin account itself
     manages a team in the shared database (the same signal the app's own `useIsManager` gate
     uses: the total of teams whose `managerId` is the admin) — never hard-coded, since a manually
     created team in the shared dev database would legitimately add the manager-gated
     Participation step.
2. They click "How pulse surveys work" in the page header and click "Next" through every step
   until "Done".
   - *Expected*: 11 steps when the admin manages no team, or 12 when they do (intro, Current
     survey, the seven-question walkthrough, anonymity, Results, Trend, the manager-gated
     Participation step — present only when the admin manages a team — Pulse cycles, Settings,
     New cycle, and the registry, plus the closing step).
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another: "nothing is saved" (intro) → "Current survey is where" (the survey tab step) →
     "Seven steps" (the questions step) → "Your answers are encrypted" (the anonymity step) →
     "Results shows closed cycles" (the results tab step) → "Trend follows one measure" (the trend
     tab step) → **when the admin manages a team**, "Participation shows who" (the participation
     tab step) here → "Pulse cycles is the admin registry" (the admin registry page step) →
     "Settings hold the cadence" (the settings card step) → "New cycle schedules" (the schedule
     card step) → "The registry lists every cycle" (the cycle table step) → "Done takes you back
     to Pulse surveys" (the closing step, shared by every audience).
   - *Expected*: the "Participation shows who" landmark appears if and only if the admin manages a
     team — never present for a non-managing admin, always present (between "Trend follows one
     measure" and "Pulse cycles is the admin registry") for a managing one.
3. The tutorial finishes with "Done".
   - *Expected*: they land back on the Pulse surveys page, on the survey tab
     (`/pulse?tab=survey`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — nothing was created, edited, or deleted while looking around, and no cycle was
     touched.

## Scenario: the pulse surveys tutorial walks a manager through 8 read-only steps and returns to the Pulse surveys page

1. Manager AAA — a manager, not an admin — signs in; the alert banner is collapsed first. They
   open the Pulse surveys page; from here on every non-GET API request the page issues is
   recorded. They click "How pulse surveys work", then "Next" through every step until "Done".
   - *Expected*: exactly 8 steps — intro, Current survey, the seven-question walkthrough,
     anonymity, Results, Trend, the manager-gated Participation step, and the closing step; none
     of the four admin-only registry steps ("Pulse cycles is the admin registry", "Settings hold
     the cadence", "New cycle schedules", "The registry lists every cycle") appear.
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another, ending with "Participation shows who" between "Trend follows one measure" and "Done
     takes you back to Pulse surveys".
2. The tutorial finishes with "Done".
   - *Expected*: they land back on the Pulse surveys page, on the survey tab
     (`/pulse?tab=survey`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — the manager walk is read-only too.

## Scenario: the pulse surveys tutorial shows a team member 7 steps without the participation and admin steps

1. AAA One — a team member of team AAA, not a manager — signs in; the alert banner is collapsed
   first. They open the Pulse surveys page; from here on every non-GET API request the page issues
   is recorded. They click "How pulse surveys work", then "Next" through every step until "Done".
   - *Expected*: exactly 7 steps — the manager-gated Participation step and the four admin-only
     registry steps are absent, and no step's text mentions "Participation shows who", "Pulse
     cycles is the admin registry", or "New cycle schedules".
2. The tutorial finishes with "Done".
   - *Expected*: they land back on the Pulse surveys page, on the survey tab
     (`/pulse?tab=survey`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — the team-member walk is read-only too.
