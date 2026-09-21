# "How succession plans work" tutorial — manager vs. non-manager walks

- **Spec**: [tests/succession-tutorial.spec.ts](../tests/succession-tutorial.spec.ts)
- **Actors**: Manager AAA (a manager), AAA One (a non-manager) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only. The tutorial only navigates and
  spotlights stable chrome (tabs, the New plan header button, the Filters panel, the create form's
  two Fieldsets and its footer actions, and the dashboard cards' Succession plan button); it never
  clicks a spotlighted control or creates/edits a real plan, so walking it mutates no server state.
  Safe under parallel workers — the parallel `succession.spec.ts` creates and edits plans as
  Manager AAA (a plan for seat AAA One, candidates AAA Two/Three), but list totals are never
  compared here; the walker's own non-GET API traffic is recorded instead and asserted empty. The
  Succession plans nav leaf is manager-only, so the non-manager walk opens `/succession` directly
  by URL rather than through the nav.
- **Since**: v3.22.0

## Scenario: the succession plans tutorial walks a manager through 13 read-only steps and returns to the Succession plans page

1. Manager AAA signs in; the alert banner is collapsed first (a pre-existing active alert's
   expanded banner would overlay the header). They open the Succession plans page; from here on
   every non-GET API request the page issues is recorded, to prove afterward that nothing was
   written.
2. They click "How succession plans work" in the page header and click "Next" through every step
   until "Done".
   - *Expected*: exactly 13 steps for a manager (intro, My plans, its Filters, My subordinates'
     plans, the New-plan action, the new-plan form's Seat & criticality section, its Loss impact
     section, the form's actions, how nominations work, the Review screen, who can read a plan,
     the My-subordinates dashboard cards, and the closing My-plans step).
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another: "nothing is saved" (intro) → "My plans lists" (the own tab) → "Under Filters you
     narrow" (the own tab's Filters step) → "My subordinates' plans shows" (the team tab) →
     "A new plan starts here" (the New-plan step) → "Pick a person from your reporting line" (the
     form's Seat & criticality step) → "Loss impact is a short ordered list" (the form's Loss
     impact step) → "Create saves the plan" (the form's actions step) → "Nominations are the
     successors" (the nominations step) → "Opening a plan is the Review screen" (the Review
     screen step) → "Only the owner writes a plan" (the access-model step) → "Each card on My
     subordinates" (the My-subordinates dashboard cards) → "Done takes you back to Succession
     plans" (the closing My-plans step, the shared last step for both roles).
3. The tutorial finishes with "Done".
   - *Expected*: they land back on Succession plans, on the own-plans tab
     (`/succession?tab=own`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — nothing was created, edited, or deleted while looking around.

## Scenario: the succession plans tutorial shows a non-manager 5 steps without the planning steps

1. AAA One — a non-manager — signs in; the alert banner is collapsed first. They open the
   Succession plans page directly by URL (the nav leaf is manager-only, so there is no menu entry
   to click); from here on every non-GET API request the page issues is recorded. They click "How
   succession plans work", then "Next" through every step until "Done".
   - *Expected*: exactly 5 steps — the eight manager-only steps (My subordinates' plans, the
     New-plan action, the new-plan form's two sections and its actions, how nominations work, the
     Review screen, and the My-subordinates dashboard cards) are absent, and no step's text
     mentions "My subordinates' plans shows", "A new plan starts here", "Nominations are the
     successors", or "Each card on My subordinates".
2. The tutorial finishes with "Done".
   - *Expected*: they land back on Succession plans, on the own-plans tab
     (`/succession?tab=own`).
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — the non-manager walk is read-only too.
