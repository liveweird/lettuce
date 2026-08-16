# Self-reflection

- **Spec**: [tests/self-reflection.spec.ts](../tests/self-reflection.spec.ts)
- **Actors**: AAA Two (both provider and subject) — seed account
- **Owns** (exclusive server-side state): the (subject AAA Two ← provider AAA Two)
  self-reflection feedback triple

Feedback where the caller is both provider and subject, entered from the dedicated left-menu
screen; the saved row lands in the ordinary Provided feedback tab.

## Scenario: a user writes and sends a self-reflection where both parties are themselves

1. AAA Two signs in and opens "Self-reflection" from the left menu.
   - *Expected*: the "Self-reflection" screen opens, showing both parties as "You".
2. AAA Two inspects the Visibility selector.
   - *Expected*: it defaults to "Provider + subject" and offers exactly the two no-requester
     choices — "Provider + subject" and "Public".
3. AAA Two types a unique text and clicks "Save & send".
   - *Expected*: saving lands on the feedback screen's "Provided" tab; sorted newest-first,
     the new row is visible (the shared dev database accumulates provided rows for AAA Two
     across runs, so under the default sort a fresh row eventually falls off page 1).
4. AAA Two opens the document.
   - *Expected*: the status reads "Sent" and the content is readable by its author.
