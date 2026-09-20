# "How goals work" tutorial — manager vs. non-manager walks

- **Spec**: [tests/goals-tutorial.spec.ts](../tests/goals-tutorial.spec.ts)
- **Actors**: Manager AAA (a manager), AAA One (a non-manager) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only. The tutorial only navigates and
  spotlights stable chrome (tabs, header buttons, form controls, dashboard cards); it never clicks
  a spotlighted control or creates a real goal, so walking it mutates no server state. Safe under
  parallel workers.
- **Since**: v3.15.0

## Scenario: the goals tutorial walks a manager through 12 read-only steps and returns to the Goals page

1. Manager AAA signs in; the alert banner is collapsed first (a pre-existing active alert's
   expanded banner would overlay the header). They open the Goals page and note their current
   own goal total via the API, to prove afterward that nothing changed (the managed total is
   deliberately not compared: the parallel `goals.spec.ts` creates goals for AAA Two as Manager AAA).
2. They click "How goals work" in the page header and click "Next" through every step until
   "Done".
   - *Expected*: exactly 12 steps for a manager (intro, lifecycle, My goals, Filters, progress,
     Goals I've set, the New-goal form's setup and actions, the goal page's lifecycle actions, My
     subordinates, and My managers).
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another: "nothing is saved" (intro) → "starts as a Draft" (the lifecycle step) → "My goals
     lists" (the own-goals tab) → "by title, status" (the Filters step) → "record progress" (the
     progress step) → "widens it from your direct reports" (the Goals-I've-set Reports scope) →
     "Creating a goal starts here" (the New-goal form) → "Pick the team member" (the definition
     fields) → "Create saves the draft" (the form actions) → "run its lifecycle" (the goal page's
     lifecycle actions) → "My subordinates" (the dashboard's My subordinates card) → "Done takes
     you back to Goals" (the dashboard's My managers card).
3. The tutorial finishes with "Done".
   - *Expected*: they land back on Goals, on the own-goals tab.
   - *Expected*: their own goal total, re-read from the API, is unchanged — nothing
     was created, activated, or modified while looking around.

## Scenario: the goals tutorial shows a non-manager 6 steps without the manager steps

1. AAA One — a non-manager — signs in; the alert banner is collapsed first. They open the Goals
   page and click "How goals work", then "Next" through every step until "Done".
   - *Expected*: exactly 6 steps — the six manager-only steps (Goals I've set, the New-goal form's
     setup and actions, the goal page's lifecycle actions, and My subordinates) are absent, and no
     step's text mentions "widens it from your direct reports", "Creating a goal starts here", or
     "My subordinates".
2. The tutorial finishes with "Done".
   - *Expected*: they land back on Goals, on the own-goals tab.
