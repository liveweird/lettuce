# "How the impact log works" tutorial — manager vs. non-manager walks

- **Spec**: [tests/impact-log-tutorial.spec.ts](../tests/impact-log-tutorial.spec.ts)
- **Actors**: Manager AAA (a manager), AAA One (a non-manager) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only. The tutorial only navigates and
  spotlights stable chrome (tabs, header buttons, the Filters panel, the create form's permanent
  title/period header, its Stepper rail and its footer actions, and the dashboard cards'
  Impact-log button); it never clicks a spotlighted control or creates/edits a real entry, so
  walking it mutates no server state. Safe under parallel workers — the parallel
  `impact-log.spec.ts` creates, edits and deletes entries as AAA Two and reads them as Manager
  AAA, but list totals are never compared here; the walker's own non-GET API traffic is recorded
  instead and asserted empty.
- **Since**: v3.19.0

## Scenario: the impact log tutorial walks a manager through 12 read-only steps and returns to the Impact log page

1. Manager AAA signs in; the alert banner is collapsed first (a pre-existing active alert's
   expanded banner would overlay the header). They open the Impact log page; from here on every
   non-GET API request the page issues is recorded, to prove afterward that nothing was written.
2. They click "How the impact log works" in the page header and click "Next" through every step
   until "Done".
   - *Expected*: exactly 12 steps for a manager (intro, My journal, its Filters, the New-entry
     action, the form's permanent title/period header, the form's step rail, the four sections'
     meaning, the form's Back/Next/Create actions, My subordinates' journals, its Filters, the
     My-subordinates dashboard cards' Impact-log button, and the closing entry-view step).
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another: "nothing is saved" (intro) → "My journal lists" (the own tab) → "Under Filters you
     narrow" (the own tab's Filters step) → "A new entry starts here" (the New-entry step) →
     "The title and the period stay visible" (the form's header step) → "one section at a time"
     (the form's step-rail step) → "Each section is markdown" (the sections-meaning step) →
     "Back and Next move" (the form's actions step) → "My subordinates' journals lists" (the
     managed tab) → "Here Filters add the author" (the managed tab's Filters step) → "Each card
     on My subordinates" (the My-subordinates dashboard cards) → "Done takes you back to the
     Impact log" (the closing entry-view step, the shared last step for both roles).
3. The tutorial finishes with "Done".
   - *Expected*: they land back on the Impact log page, on the own-journal tab
     (`/impact-log?tab=own`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — nothing was created, edited, or deleted while looking around.

## Scenario: the impact log tutorial shows a non-manager 9 steps without the subordinates steps

1. AAA One — a non-manager — signs in; the alert banner is collapsed first. They open the Impact
   log page; from here on every non-GET API request the page issues is recorded. They click "How
   the impact log works", then "Next" through every step until "Done".
   - *Expected*: exactly 9 steps — the three manager-only steps (My subordinates' journals, its
     Filters, and the My-subordinates dashboard cards' Impact-log button) are absent, and no
     step's text mentions "My subordinates' journals lists", "Here Filters add the author", or
     "Each card on My subordinates".
2. The tutorial finishes with "Done".
   - *Expected*: they land back on the Impact log page, on the own-journal tab
     (`/impact-log?tab=own`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — the non-manager walk is read-only too.
