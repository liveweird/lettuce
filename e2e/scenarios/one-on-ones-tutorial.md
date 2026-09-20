# "How 1:1 meetings work" tutorial — manager vs. non-manager walks

- **Spec**: [tests/one-on-ones-tutorial.spec.ts](../tests/one-on-ones-tutorial.spec.ts)
- **Actors**: Manager AAA (a manager), AAA One (a non-manager) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only. The tutorial only navigates and
  spotlights stable chrome (tabs, header buttons, the Filters panel, the create form's fields and
  actions, the dashboard cards' 1:1 meetings menu); it never clicks a spotlighted control or
  creates/edits a real meeting, so walking it mutates no server state. Safe under parallel
  workers — the parallel `one-on-ones.spec.ts` creates and edits meetings as Manager AAA, but list
  totals are never compared here; the walker's own non-GET API traffic is recorded instead and
  asserted empty.
- **Since**: v3.18.0

## Scenario: the 1:1 meetings tutorial walks a manager through 13 read-only steps and returns to the 1:1 meetings page

1. Manager AAA signs in; the alert banner is collapsed first (a pre-existing active alert's
   expanded banner would overlay the header). They open the 1:1 meetings page; from here on every
   non-GET API request the page issues is recorded, to prove afterward that nothing was written.
2. They click "How 1:1 meetings work" in the page header and click "Next" through every step
   until "Done".
   - *Expected*: exactly 13 steps for a manager (intro, the I'm-a-subordinate tab, its Filters,
     a meeting document's three lists, action-item carry-over, the I'm-a-manager tab, the
     My-subordinate's-a-manager tab, the New-1:1 action, the New-1:1 form's fields, the form's
     actions, the editor, the My-subordinates dashboard cards, and the My-managers dashboard
     card).
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another: "nothing is saved" (intro) → "I'm a subordinate lists" (the own tab) → "Under
     Filters you narrow" (the own tab's Filters step) → "three lists" (the meeting-document
     step) → "carried over into it automatically" (the carry-over step) → "I'm a manager lists"
     (the managed tab) → "My subordinate's a manager shows" (the team tab) → "A new 1:1 starts
     here" (the New-1:1 step) → "Pick the team member" (the New-1:1 form's fields) → "Create
     saves the meeting" (the form's actions) → "In the editor you add" (the editor step) →
     "Each card on My subordinates" (the My-subordinates dashboard cards) → "Done takes you back
     to 1:1 meetings" (the My-managers dashboard card, the shared last step for both roles).
3. The tutorial finishes with "Done".
   - *Expected*: they land back on 1:1 meetings, on the own-meetings tab (`/one-on-ones?tab=own`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — nothing was created, edited, or deleted while looking around.

## Scenario: the 1:1 meetings tutorial shows a non-manager 6 steps without the team steps

1. AAA One — a non-manager — signs in; the alert banner is collapsed first. They open the 1:1
   meetings page; from here on every non-GET API request the page issues is recorded. They click
   "How 1:1 meetings work", then "Next" through every step until "Done".
   - *Expected*: exactly 6 steps — the seven manager-only steps (the I'm-a-manager tab, the
     My-subordinate's-a-manager tab, the New-1:1 action, the New-1:1 form's fields and actions,
     the editor, and the My-subordinates dashboard cards) are absent, and no step's text mentions
     "I'm a manager lists", "A new 1:1 starts here", or "In the editor you add".
2. The tutorial finishes with "Done".
   - *Expected*: they land back on 1:1 meetings, on the own-meetings tab
     (`/one-on-ones?tab=own`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — the non-manager walk is read-only too.
