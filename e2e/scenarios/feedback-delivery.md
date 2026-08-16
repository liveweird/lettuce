# Feedback delivery — the receiving side

- **Spec**: [tests/feedback-delivery.spec.ts](../tests/feedback-delivery.spec.ts)
- **Actors**: AAA Two (provider), AAA One (subject) — seed accounts
- **Owns** (exclusive server-side state): the (subject AAA One ← provider AAA Two) feedback
  triple — AAA Two provides (not the manager) because the manager's no-requester triples
  belong to manager-oversight / feedback-lifecycle-rest / hr

## Scenario: subject cannot see a draft, then receives and reads the sent feedback via the bell

1. AAA Two signs in, saves a draft feedback about AAA One with a unique text, and signs out.
2. AAA One signs in and opens the feedback screen's "Received" tab, sorted newest-first (so a
   leaked draft would sit at the top of page 1 of the shared database).
   - *Expected*: the draft is nowhere in the list — a draft is invisible to its subject.
3. AAA One signs out; AAA Two signs back in, reopens the draft in the editor, clicks
   "Save & send", and signs out.
4. AAA One signs in and opens the "Received" tab again, sorted newest-first.
   - *Expected*: the now-sent feedback appears in the list.
5. AAA One opens the notification bell and looks for the card reading "Feedback from AAA Two
   about AAA One has been sent." (found by its text — a seed account's bell also receives
   concurrent traffic from other running specs).
   - *Expected*: the delivery notification card is present.
6. AAA One clicks the card's "Go to".
   - *Expected*: the feedback's view page opens, showing the content and status "Sent".
7. AAA One reopens the bell.
   - *Expected*: following the link marked the notification as seen — the same card now
     offers "Mark as unseen".
