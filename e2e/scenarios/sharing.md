# Document sharing — share, read read-only, withdraw

- **Spec**: [tests/sharing.spec.ts](../tests/sharing.spec.ts)
- **Actors**: Administrator (creates the throwaways), three throwaway users — a provider P, a
  subject S and a bystander sharee X
- **Owns** (exclusive server-side state): the three throwaway users, one feedback (P to S, sent,
  `PROVIDER_SUBJECT` visibility — so X cannot read it without a share) and the one share of it
  to X. Nothing else in the suite touches any of them; the residue sweep removes the users.
- **Since**: v4.8.0

## Scenario: a provider shares a feedback, the sharee reads it read-only, and withdrawing ends the access

1. The administrator creates the three throwaway users through the Users form (the one-time
   password reveal supplies each credential) and signs out. P's sent feedback about S is then
   created over the API — setup only; the journey under test starts at the Share button.
2. P signs in, opens the feedback and presses "Share", picks X in the "Share with" picker, enters
   an end date 30 days ahead in "Until" and submits.
   - *Expected*: the "Document shared" toast appears, and the dialog's current shares list now
     names X as an active share with an end date. P signs out.
3. X signs in and opens the notification bell.
   - *Expected*: the card "<P> shared feedback with you." is there; following its "Go to"
     action opens the feedback.
   - *Expected*: the page says "Shared with you by <P>" and shows the content, but offers X no
     "Share" button and no "Withdraw" action — only Close (X holds the feedback through the share
     alone).
4. X opens the Shared screen.
   - *Expected*: "Shared with me" is the selected tab, and a row "From <P> to <S>" shows status
     Active and names P as the sharer. X signs out.
5. P opens the feedback again, presses "Share", chooses "Withdraw the share with <X>" and
   confirms.
   - *Expected*: the "Share withdrawn" toast appears and X's row in the current shares reads
     Withdrawn. P signs out.
6. X signs in again, opens the Shared screen and filters by status Active.
   - *Expected*: "No shares match these filters." — no row for the feedback.
   - *Expected*: opening the feedback's address directly answers "You don't have permission to
     view this feedback." and the content is not shown. (There is no lapse message here: the
     lapse wording is for shares that still exist but whose sharer lost the right to read — a
     withdrawn share leaves X with no share at all, i.e. the ordinary denial.)

## Not covered here (and why)

- The sharer-lapse 403 ("the person who shared this no longer has access"), the author
  withdrawing someone else's share, and every other document kind — covered by the server's
  `SharingTest` matrix and the SPA's per-page vitest cases; one browser journey over the
  feedback kind proves the wiring end to end.
