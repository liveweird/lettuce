# Provide feedback — draft, send, withdraw

- **Spec**: [tests/feedback-provide.spec.ts](../tests/feedback-provide.spec.ts)
- **Actors**: AAA One (provider), AAA Two (subject) — seed accounts
- **Owns** (exclusive server-side state): the (subject AAA Two ← provider AAA One) feedback
  triple — the server 409s a create while an open (DRAFT/REQUESTED) duplicate exists, so no
  other spec file may use this pair

## Scenario: provider drafts, sends, and withdraws a feedback

1. AAA One signs in.
2. On the users list, AAA One filters by name to find AAA Two (filter first so the row is on
   page 1 even after runs accumulate E2E users) and chooses "Provide feedback" for them.
   - *Expected*: the feedback create editor opens.
3. AAA One types a unique feedback text and clicks "Save draft".
   - *Expected*: the draft is created (its id is captured so every later step acts on exactly
     this row, regardless of any other data in the shared database).
4. AAA One reopens the draft in the editor and clicks "Save & send".
   - *Expected*: the feedback is delivered.
5. AAA One opens the feedback's view page.
   - *Expected*: the typed content is shown read-only and the status reads "Sent".
6. AAA One clicks "Withdraw" and confirms "Withdraw" in the confirmation dialog.
7. AAA One reopens the feedback's view page.
   - *Expected*: the status reads "Withdrawn".
