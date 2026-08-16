# Days off — request, resolve, calendar, corrections

- **Spec**: [tests/days-off.spec.ts](../tests/days-off.spec.ts)
- **Actors**: the seed admin (`admin@lettuce.local`), AAA Two (`aaa-two@lettuce.local`, the
  requester), Manager AAA (`manager-aaa@lettuce.local`, the resolving direct manager)
- **Owns** (exclusive server-side state): the public-holidays registry, plus AAA Two's days-off
  requests, paid-leave allowance, and budget corrections — this file is their single writer
  under parallel workers.
- **Since**: v1.43.0 (budget corrections), v1.44.0 (subordinate-card vacation stats)

**Preconditions.** The booked window is a run-varying future Monday (4–43 weeks out); the whole
two-week window stays inside one calendar year and clear of the seeded Polish statutory holidays
(their zero cost would break the expected cost numbers). Before any UI step, residue from a
failed earlier run is swept via the API: stranded "E2E Holiday" registry entries are deleted
(a leftover holiday silently changes a later run's cost preview when its window happens to cover
that date), AAA Two's still-counting requests (pending ones, and accepted ones strictly in the
future) are cancelled, and stranded "E2E correction" rows are deleted (the run window repeats
every 40 minutes, so a later run could otherwise mint a second correction with an identical
comment). The suite thus self-heals on the next run no matter where a run died.

## Scenario: days off end to end: holiday, allowance, request, resolve, calendar, cancel

1. The admin opens Public holidays and adds "E2E Holiday \<Monday\>" on the first booked Monday.
   - *Expected*: "Public holiday added" (a residual holiday from a failed run answers "A holiday
     already exists on this date." instead — either way the date is now covered), and the
     holiday appears in the list.
2. The admin edits AAA Two (users list → Modify actions → Edit), sets the paid days-off
   allowance to 300 days per year, and saves.
   - *Expected*: back on the users list.
3. AAA Two opens Days off → My requests and files a PAID request for the holiday week's
   Monday–Tuesday via "New request".
   - *Expected*: the budget strip "Your paid days off in \<year\>" is visible; the live cost
     preview reads "This request costs 1 working day(s)." (the Monday holiday is free —
     the half-day-cost edge); "Days-off request submitted" confirms.
4. AAA Two files a second PAID request for the following Monday–Tuesday.
   - *Expected*: the cost preview reads 2 working day(s); both rows sit in My requests as
     Requested.
5. Manager AAA signs in and opens the bell.
   - *Expected*: an "AAA Two requested time off" notification.
6. On Days off → Team, the manager filters the table to status Requested (why: far-future
   rejected/cancelled leftovers from earlier runs outrank this run's rows in the date-sorted
   table on the shared database — the filter keeps the fresh pending rows on page 1), then
   Accepts the first request and Rejects the second (confirming the Reject dialog).
   - *Expected*: "Request accepted", then "Request rejected".
7. The manager opens the Dashboard's subordinates tab and looks at AAA Two's card.
   - *Expected*: "Next vacation" with the accepted Monday's date, and "Days-off budget left".
8. The card's "Days off of AAA Two" link opens the per-user drill-down; the manager filters it
   to Accepted (the same shared-database page-1 rule).
   - *Expected*: the "Days off of AAA Two" heading, the "Paid days off of AAA Two in \<year\>"
     budget strip, and the Accepted row.
9. AAA Two signs back in and opens the bell.
   - *Expected*: both outcomes are notified — "Manager AAA accepted your days-off request" and
     "Manager AAA rejected your days-off request".
10. On My requests, AAA Two filters to Rejected, then to Accepted.
    - *Expected*: each filter surfaces the matching row.
11. On the Calendar tab, AAA Two pages forward to the request's month.
    - *Expected*: the team days-off calendar marks the accepted Tuesday — "AAA Two — \<date\>:
      Paid, Accepted (1 day)".
12. AAA Two cancels the accepted (still future) request from My requests, confirming with
    "Cancel the request".
    - *Expected*: "Request cancelled" — the reserved days return to the budget.
13. AAA Two notes the paid-budget strip, then files an UNPAID single-day request for the
    Wednesday of the booked week.
    - *Expected*: the same live cost preview ("1 working day(s)"); under the Requested filter
      the fresh row shows Unpaid; the paid-budget strip is byte-for-byte unchanged.
14. AAA Two cancels the unpaid request too (why: seed accounts must keep no counting rows —
    rejected/cancelled records are inert).
    - *Expected*: "Request cancelled".
15. Manager AAA opens "Budget corrections of AAA Two" from the team tab and adds a +2-day
    correction with the comment "E2E correction \<Monday\>".
    - *Expected*: "Correction added", and the correction is listed in the modal.
16. AAA Two signs in, checks the bell, then opens their own Corrections modal from My requests.
    - *Expected*: an "added 2 day(s) to your paid days-off budget" notification; the correction
      shows read-only — no "Add correction" form and no per-row actions.

**Cleanup** (in-test, through the UI): Manager AAA deletes the correction ("Correction
deleted"); the admin deletes the holiday ("Public holiday deleted") — nothing this run created
persists on the seed accounts or the registry.
