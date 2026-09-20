# "How feedback works" tutorial — manager vs. non-manager walks

- **Spec**: [tests/feedback-tutorial.spec.ts](../tests/feedback-tutorial.spec.ts)
- **Actors**: Manager AAA (a manager), AAA One (a non-manager) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only. The tutorial only navigates and
  spotlights stable chrome (tabs, header buttons, form controls, nav links); it never clicks a
  spotlighted control or opens a real feedback (`READ_ONLY_STEP_DEFAULTS` blocks target
  interaction on every step), so walking it mutates no server state. Safe under parallel workers.
- **Since**: v3.14.0

## Scenario: the feedback tutorial walks a manager through 12 read-only steps and returns to the Feedback page

1. Manager AAA signs in; the alert banner is collapsed first (a pre-existing active alert's
   expanded banner would overlay the header). They open the Feedback page; from here on every
   non-GET API request the page issues is recorded, to prove afterward that nothing was written
   (list totals are not a safe oracle: parallel specs write feedback as Manager AAA).
2. They click "How feedback works" in the page header, next to New feedback, and click "Next"
   through every step until "Done".
   - *Expected*: exactly 12 steps for a manager (intro, lifecycle, Received, Provided, My team,
     the Reports scope, the New-feedback form's setup and actions, Ask for feedback, Request
     feedback, and the Kudos wall).
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another: "nothing is saved" (intro) → "Requested" (the lifecycle step) → "Received lists"
     → "Provided is everything" → "My team shows" → "Reports" (the Filters scope step) →
     "Writing feedback starts here" (the New-feedback form) → "Pick up to four" (recipients +
     visibility) → "Save draft keeps" (the save actions) → "Ask for feedback" (the dashboard's
     My managers card) → "Request feedback" (the dashboard's My reports card) → "Kudos wall".
3. The tutorial finishes with "Done".
   - *Expected*: they land back on Feedback, on the Received tab.
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — nothing was created, sent, or modified while looking around.

## Scenario: the feedback tutorial shows a non-manager 9 steps without the team steps

1. AAA One — a non-manager — signs in; the alert banner is collapsed first. They open the
   Feedback page and click "How feedback works", then "Next" through every step until "Done".
   - *Expected*: exactly 9 steps — the two manager-only steps (My team, and requesting feedback
     about a report from someone else) are absent, and no step's text mentions "My team shows" or
     "Request feedback".
2. The tutorial finishes with "Done".
   - *Expected*: they land back on Feedback, on the Received tab.
   - *Expected*: the page issued no non-GET API request during the walk (the token refresh
     excepted) — the non-manager walk is read-only too.
