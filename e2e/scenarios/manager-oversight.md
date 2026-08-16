# Manager oversight — team feedback surfaces

- **Spec**: [tests/manager-oversight.spec.ts](../tests/manager-oversight.spec.ts)
- **Actors**: Manager AAA (provider and manager), AAA One (subject) — seed accounts
- **Owns** (exclusive server-side state): the (subject AAA One ← provider Manager AAA)
  feedback triple, created directly as SENT — so it leaves no open DRAFT/REQUESTED window to
  collide with other files

## Scenario: manager sees a delivered team feedback in the team tab and the per-user screen

1. Manager AAA signs in, filters the users list by name to find AAA One (filter first so the
   row is on page 1 even after runs accumulate E2E users), and chooses "Provide feedback".
2. Manager AAA types a unique feedback text and clicks "Save & send" — delivered in one step,
   directly as Sent (the feedback's id and the subject's id are captured so the later list
   asserts target exactly this row).
3. Manager AAA opens the feedback screen's "My team" tab (a manager-only view), sorted
   newest-first (to stay on page 1 of the shared database).
   - *Expected*: the just-delivered feedback is listed.
4. Manager AAA opens AAA One's per-user two-way feedbacks screen, reached from the dashboard's
   subordinates drill-down.
   - *Expected*: the screen is headed "Feedbacks with AAA One" and offers the two directions
     as tabs — "From AAA One to you" (the received direction, active by default) and
     "From you to AAA One".
5. Manager AAA switches to the "From you to AAA One" tab and sorts it newest-first.
   - *Expected*: the just-delivered feedback is listed there.
