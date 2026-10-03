# Days-off calendar sharing — share one, share two in one go, read via "Shared with me", withdraw one

- **Spec**: [tests/days-off-sharing.spec.ts](../tests/days-off-sharing.spec.ts)
- **Actors**: Administrator (creates the throwaways), four throwaway users — a manager M, two
  reports R1 and R2, and a bystander sharee X outside the reporting line
- **Owns** (exclusive server-side state): the four throwaway users, one throwaway team (manager M,
  members R1 and R2), a paid allowance for R1 and R2, one PAID days-off entry next month for each
  (booked by M on their behalf), and the calendar shares of R1 and R2 to X. Nothing else in the
  suite touches any of them; the residue sweep removes the users and the team (the entries, the two
  default-pool grants and the shares stay behind, inert — all owned by soft-deleted users). The public-holiday
  registry (owned by `days-off.spec`) is never written — a candidate day that a parallel spec's
  holiday made free of cost is refused by the server and the next candidate day is used.
- **Since**: v4.11.0

## Scenario: a manager shares two reports' days-off calendars, the sharee sees them in Shared with me, and one share is withdrawn

1. The administrator creates the four throwaway users through the Users form (the one-time
   password reveal supplies each credential) and signs out. The throwaway team (manager M, members
   R1 and R2), the allowance for R1 and R2 and one PAID entry next month for each are then created
   over the API — setup only; the journey under test starts at the Calendar tab.
2. M signs in, opens Days off → Calendar, steps to next month and picks "My direct reports" under
   "Whose calendar".
   - *Expected*: R1's row is listed, and its entry's cell description names the pool itself
     ("Paid days off") — the contrast to what the sharee sees later.
3. M presses the share icon on R1's row ("Share the days-off calendar of <R1>"), picks X in "Share
   with", enters an end date 30 days ahead in "Until" and submits.
   - *Expected*: the "Calendar shared" toast appears and the dialog's current shares list shows an
     Active share. M closes the dialog and signs out.
4. X signs in and opens the notification bell.
   - *Expected*: a card "<M> shared <R1>'s days-off calendar with you." is there; following its
     "Go to" action opens the Calendar tab on "Shared with me", R1's row highlighted, labelled
     "Shared by <M>".
5. X steps to next month.
   - *Expected*: R1's absence reads "<R1> — <date>: Paid (1 day)" — the pool name never reaches
     the sharee (no cell description mentions "Paid days off"), R2 is not listed yet, no row
     offers X a Share icon, and reading R1's entry directly over the API is refused (403). The
     Shared screen lists the share as "Days-off calendar of <R1>". X signs out.
6. M signs in, opens Days off → Team and follows "Share calendars…". On the mass-share page both
   reports are listed with enabled "Select <name>" checkboxes; M opens the filters, narrows
   "Teams" to the throwaway team and presses "Select all matching (2)", then "Share 2 calendars…",
   picks X and submits (no end date).
   - *Expected*: the "Calendars shared" toast appears; the dialog's result reads "New shares: 1"
     (R2), and lists "<R1>: already shared with <X>" under "Already shared. Left unchanged,
     including their end date:" (the single share from step 3 stays untouched). M signs out.
7. X signs in and opens the bell.
   - *Expected*: ONE summary card "<M> shared 1 days-off calendar with you." (the batch counts
     only the new share) and no per-calendar card for R2; following it opens the shared scope, and
     next month lists both R1's and R2's rows with the redacted "Paid (1 day)" descriptions. X
     signs out.
8. R1 — the person, hence the author of every share of their own calendar — signs in, opens Days
   off → Calendar ("My teams") and presses the share icon on their own row ("Share my days-off
   calendar").
   - *Expected*: the dialog's current shares lists X's share, "Shared by <M>".
9. R1 withdraws it ("Withdraw the share with <X>") and confirms.
   - *Expected*: the "Share withdrawn" toast appears and the row reads Withdrawn. R1 signs out.
10. X signs in again and opens the shared scope on next month.
    - *Expected*: R2's row is listed and R1's row is gone.

## Not covered here (and why)

- The paid pool's NAME being redacted for an extra (non-default) pool: the days-off pool kinds are
  a global registry owned by `days-off.spec`, so this spec uses the default pool, whose name ("Paid
  days off") is just as observable — the server's `DaysOffCalendarSharedScopeTest` pins the
  extra-pool case.
- The lapse rule (a sharer leaving the chain, a deactivated or soft-deleted person), the other
  facet filters, paging and the 20-recipient/200-person caps — covered by the server's
  `DaysOffCalendarSharedScopeTest` / `SharingTest` / `ShareBatchRoutesTest` and the SPA's vitest
  cases; one browser journey proves the wiring end to end.
- The sharer-side links (Shared → "Shared by me", the activity log) — SPA unit-tested
  (`shareOpenPath`, `ActivityLog`).
