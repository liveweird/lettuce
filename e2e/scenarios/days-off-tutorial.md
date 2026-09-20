# "How days off work" tutorial — manager vs. non-manager walks

- **Spec**: [tests/days-off-tutorial.spec.ts](../tests/days-off-tutorial.spec.ts)
- **Actors**: Manager AAA (a manager), AAA One (a non-manager) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only. The tutorial only navigates and
  spotlights stable chrome (tabs, header buttons, the calendar pager/scope, the budget card, the
  team tab, the create form's fields and actions); it never clicks a spotlighted control or
  submits a real entry, so walking it mutates no server state. Only the caller's OWN days-off
  total is compared before/after — the parallel `days-off.spec.ts` writes AAA Two's entries
  concurrently, and those rows ride Manager AAA's `view=managed` list, so a `managed` total is
  deliberately NOT compared (it would race against unrelated state, not signal anything about this
  walk); nobody writes Manager AAA's or AAA One's own rows, so `view=own` stays safe under
  parallel workers.
- **Since**: v3.16.0

## Scenario: the days-off tutorial walks a manager through 12 read-only steps and returns to the Days off page

1. Manager AAA signs in; the alert banner is collapsed first (a pre-existing active alert's
   expanded banner would overlay the header). They open the Days off page and note their current
   own days-off total via the API, to prove afterward that nothing changed.
2. They click "How days off work" in the page header and click "Next" through every step until
   "Done".
   - *Expected*: exactly 12 steps for a manager (intro, the calendar, the calendar scope, the
     month pager, My days off, the budget card, My team, the team's Entries/Budgets toggle,
     recording on a report's behalf, the New-days-off form's launch, the form's fields, and the
     form's actions).
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another: "nobody approves them" (intro) → "leave planner" (the calendar step) → "Whose
     calendar switches" (the calendar scope step) → "Flip months" (the month-pager step) → "My
     days off lists" (the own-entries tab) → "what remains this year" (the budget card) → "My team
     lists" (the team tab) → "one row per report and pool" (the Entries/Budgets toggle) → "on a
     report's behalf" (the record-on-behalf step) → "Recording your own days off starts here"
     (the New-days-off launch step) → "counts working days only" (the create form's fields) →
     "Done takes you back to Days off" (the create form's actions).
3. The tutorial finishes with "Done".
   - *Expected*: they land back on Days off, on the requests tab (`/days-off?tab=requests`).
   - *Expected*: their own days-off total, re-read from the API, is unchanged — nothing was
     recorded or deleted while looking around.

## Scenario: the days-off tutorial shows a non-manager 8 steps without the manager steps

1. AAA One — a non-manager — signs in; the alert banner is collapsed first. They open the Days
   off page and note their current own days-off total via the API. They click "How days off
   work", then "Next" through every step until "Done".
   - *Expected*: exactly 8 steps — the four manager-only steps (the calendar scope, My team, the
     Entries/Budgets toggle, and recording on a report's behalf) are absent, and no step's text
     mentions "Whose calendar switches", "My team lists", or "on a report's behalf".
2. The tutorial finishes with "Done".
   - *Expected*: they land back on Days off, on the requests tab (`/days-off?tab=requests`).
   - *Expected*: their own days-off total, re-read from the API, is unchanged.
