# Days off — request, resolve, calendar, corrections

- **Spec**: [tests/days-off.spec.ts](../tests/days-off.spec.ts)
- **Actors**: the seed admin (`admin@lettuce.local`), AAA Two (`aaa-two@lettuce.local`, the
  requester), Manager AAA (`manager-aaa@lettuce.local`, the resolving direct manager)
- **Owns** (exclusive server-side state): the public-holidays registry, the paid-leave pool
  kinds registry (the "E2E Pool" kinds, v3.2.0), plus AAA Two's days-off requests, paid pools
  and allowances, and budget corrections — this file is their single writer under parallel
  workers.
- **Since**: v1.43.0 (budget corrections), v1.44.0 (subordinate-card vacation stats),
  v2.29.0 (the manager's on-behalf recording), v2.32.0 (the manager-set allowance),
  v3.2.0 (paid pools)

**Preconditions.** The booked window is a run-varying future Monday (4–43 weeks out); the whole
two-week window stays inside one calendar year and clear of the seeded Polish statutory holidays
(their zero cost would break the expected cost numbers). Before any UI step, residue from a
failed earlier run is swept via the API: stranded "E2E Holiday" registry entries are deleted
(a leftover holiday silently changes a later run's cost preview when its window happens to cover
that date), stranded "E2E Pool" kinds are archived (archiving a kind archives every grant of it,
so AAA Two's stranded pool goes with it and the name is free again), AAA Two's still-counting
requests (pending and accepted alike — cancellation is date-free with a mandatory reason since
v2.31.0; queried per counting status, since the unfiltered own list pages at 100 and the inert
residue of earlier runs outgrew that) are cancelled, and stranded "E2E correction" rows are deleted (the run window repeats
every 40 minutes, so a later run could otherwise mint a second correction with an identical
comment). The suite thus self-heals on the next run no matter where a run died.

## Scenario: days off end to end: holiday, allowance, request, resolve, calendar, cancel

1. The admin opens Public holidays and adds "E2E Holiday \<Monday\>" on the first booked Monday,
   then opens Config → Paid-leave pools and adds the pool kind "E2E Pool \<Monday\>" with
   "Unused days carry over to the next year" unchecked (a yearly-reset pool, v3.2.0).
   - *Expected*: "Public holiday added" (a residual holiday from a failed run answers "A holiday
     already exists on this date." instead — either way the date is now covered), and the
     holiday appears in the list; "Pool kind added" and the kind is listed.
2. Manager AAA signs in, opens the Dashboard's subordinates tab, and follows AAA Two's
   "Days off" card link to the per-user drill-down. Beside the default pool strip's Allowance
   figure, the pencil opens the allowance editor; the manager saves 299, reopens the editor,
   and saves 300 (why two saves: the second is an actual change on every rerun — an
   idempotent re-save of 300 would mint no fresh notification for step 9 — and the reopened
   editor's 299 prefill proves the first save persisted; v2.32.0 moved the allowance from
   the admin's user-edit form to this manager-owned spot). Then "Add pool" grants AAA Two
   the run's "E2E Pool" kind with 3 days (v3.2.0).
   - *Expected*: "Allowance saved" after each save; the reopened editor is prefilled
     with 299; "Pool added", and a second strip named after the pool appears, flagged
     "resets yearly".
3. AAA Two opens Days off → My requests and files a PAID request for the holiday week's
   Monday–Tuesday via "New request".
   - *Expected*: the budget card "Your paid days off in \<year\>" is visible and lists the
     granted pool beside the default one; the live cost preview reads "This request costs 1
     working day." (the Monday holiday is free — the half-day-cost edge); "Days-off request
     submitted" confirms.
4. AAA Two files a second PAID request for the following Monday–Tuesday, then a single-day
   request for the booked week's Friday picking the "E2E Pool" entry in the Type picker
   (v3.2.0), filters My requests to Requested (the shared-database page-1 rule), and cancels
   that pool request again with a reason (the pool's history stays counted; a cancelled row is
   inert).
   - *Expected*: the cost preview reads 2 working days; both rows sit in My requests as
     Requested; the Friday row names the pool; "Request cancelled".
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
     "Manager AAA rejected your days-off request" — plus the allowance change from step 2:
     "Manager AAA set your yearly "Paid days off" allowance to 300 day(s)." and the pool grant
     "Manager AAA set your yearly "E2E Pool \<Monday\>" allowance to 3 day(s)."
10. On My requests, AAA Two filters to Rejected, then to Accepted.
    - *Expected*: each filter surfaces the matching row.
11. On the Calendar tab, AAA Two pages forward to the request's month.
    - *Expected*: the team days-off calendar marks the accepted Tuesday — "AAA Two — \<date\>:
      Paid days off, Accepted (1 day)" (the pool's name, v3.2.0).
12. AAA Two cancels the accepted (still future) request from My requests, filling the
    mandatory Reason field and confirming with "Cancel the request".
    - *Expected*: "Request cancelled" — the reserved days return to the budget.
13. AAA Two notes the paid-budget strip, then files an UNPAID single-day request for the
    Wednesday of the booked week.
    - *Expected*: the same live cost preview ("1 working day"); under the Requested filter
      the fresh row shows Unpaid; the paid-budget strip is byte-for-byte unchanged.
14. AAA Two cancels the unpaid request too, again with a reason (why: seed accounts must
    keep no counting rows — rejected/cancelled records are inert).
    - *Expected*: "Request cancelled".
15. Manager AAA opens Days off → Team and clicks the **New days off** button under the request
    list (the on-behalf entry, v2.29.0), picks AAA Two in the "On behalf of" picker, books the
    booked week's Thursday (a PAID single day), and clicks **Submit auto-accepted**.
    - *Expected*: the cost preview reads "1 working day"; back on the team tab with the
      "Days off recorded and accepted" toast; the manager's own bell holds the durable receipt
      "You recorded days off on behalf of AAA Two".
16. Still on the team tab, Manager AAA opens "Budget corrections of AAA Two" and adds a +2-day
    correction with the comment "E2E correction \<Monday\>".
    - *Expected*: "Correction added", and the correction is listed in the modal.
17. AAA Two signs in, checks the bell, then opens their own Corrections modal from My requests.
    - *Expected*: an "added 2 day(s) to your "Paid days off" budget" notification AND a
      "Manager AAA recorded days off on your behalf" one; the correction shows read-only — no
      "Add correction" form and no per-row actions.
18. Manager AAA (from the My team tab, filtered to Accepted) cancels the recorded Thursday
    entry on AAA Two's behalf — the v2.31.0 owner-or-chain right — filling the mandatory
    Reason field (why: seed accounts must keep no counting rows, and the manager-side cancel
    is the new surface under test).
    - *Expected*: "Request cancelled"; filtering to Cancelled and sorting by "Requested on"
      newest-first (cancelled rows are permanent records — earlier runs' residue outranks this
      run's row by start date), the row's info affordance opens a popover showing the reason
      and "Manager AAA · <date>"; the manager's bell holds the receipt "You cancelled AAA
      Two's days-off request …".

**Cleanup** (in-test, through the UI): Manager AAA deletes the correction ("Correction
deleted") and archives AAA Two's "E2E Pool" grant on the drill-down ("Pool archived" — the
default pool has no archive control, and the strip disappears since the cancelled Friday left
no counting history); the admin archives the pool kind on Config → Paid-leave pools ("Pool
archived") and deletes the holiday ("Public holiday deleted") — nothing this run created
persists on the seed accounts or the registries.
