# Provide feedback — draft, send, withdraw

- **Spec**: [tests/feedback-provide.spec.ts](../tests/feedback-provide.spec.ts)
- **Actors**: AAA One (provider), AAA Two and AAA Three (the two recipients) — seed accounts
- **Owns** (exclusive server-side state): the (recipients AAA Two + AAA Three ← provider AAA
  One) feedback — the server 409s a create while an open (DRAFT/REQUESTED) feedback by the same
  provider names ANY of the same recipients (the per-recipient rule, v3.1.0), so no other spec
  file may open a draft from AAA One to either of them (hr.spec's AAA Three draft is Manager
  AAA's — a different provider, no collision)

## Scenario: provider drafts, sends, and withdraws a feedback

1. AAA One signs in.
2. AAA One opens the **Feedback** page's Provided tab and clicks the **New feedback** button
   under the list (the v2.28.0 entry, moved below the list in v2.28.1 — the house footer
   convention), then picks AAA Two AND AAA Three in the **Recipients** picker on the create
   screen (with no subject in the URL the screen offers the multi-recipient picker — up to
   four people since v3.1.0; the users-row "Provide feedback" entry, which fixes a single
   recipient, stays covered by the manager-oversight and templates journeys).
   - *Expected*: the feedback create editor opens with both recipients picked.
3. AAA One types a unique feedback text and clicks "Save draft".
   - *Expected*: the draft is created (its id is captured so every later step acts on exactly
     this row, regardless of any other data in the shared database).
4. AAA One reopens the draft in the editor and clicks "Save & send".
   - *Expected*: the feedback is delivered.
5. AAA One opens the feedback's view page.
   - *Expected*: the typed content is shown read-only, the status reads "Sent", and the people
     line names both AAA Two and AAA Three.
6. AAA One clicks "Withdraw" and confirms "Withdraw" in the confirmation dialog.
7. AAA One reopens the feedback's view page.
   - *Expected*: the status reads "Withdrawn".
