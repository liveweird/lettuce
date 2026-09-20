# Days off — no lifecycle, delete, calendar, corrections

- **Spec**: [tests/days-off.spec.ts](../tests/days-off.spec.ts)
- **Actors**: the seed admin (`admin@lettuce.local`), AAA Two (`aaa-two@lettuce.local`, the
  entry owner), Manager AAA (`manager-aaa@lettuce.local`, AAA Two's direct manager and a chain
  manager), AAA One (`aaa-one@lettuce.local`, AAA Two's teammate on team AAA — the
  create/delete notification fan-out's teammate leg), Manager CCC (`manager-ccc@lettuce.local`,
  an INDIRECT chain manager two levels up — team CCC's manager; AAA Two reports to Manager AAA,
  who sits on team CCC — the includeIndirect widening leg, v3.13.0)
- **Owns** (exclusive server-side state): the public-holidays registry, the paid-leave pool
  kinds registry (the "E2E Pool" kinds, v3.2.0), plus AAA Two's days-off entries, paid pools
  and allowances, and budget corrections — this file is their single writer under parallel
  workers.
- **Since**: v1.43.0 (budget corrections), v1.44.0 (subordinate-card vacation stats),
  v2.29.0 (the manager's on-behalf recording), v2.32.0 (the manager-set allowance),
  v3.2.0 (paid pools), **v3.9.0 (the approval lifecycle is gone: every entry is active from
  creation, delete replaces accept/reject/cancel, and create/delete fan out a notification to
  the owner's whole team + their direct manager, minus whoever acted)**, v3.13.0 (the calendar's
  "Whose calendar" and the Team tab's "Reports" both widen from direct reports to the caller's
  whole transitive chain, and every widened row carries the person's team(s))

**Preconditions.** The booked window is a run-varying future Monday (4–43 weeks out); the whole
week stays inside one calendar year and clear of the seeded Polish statutory holidays (their
zero cost would break the expected cost numbers). Before any UI step, residue from a failed
earlier run is swept via the API: stranded "E2E Holiday" registry entries are deleted (a
leftover holiday silently changes a later run's cost preview when its window happens to cover
that date), stranded "E2E Pool" kinds are archived (archiving a kind archives every grant of
it, so AAA Two's stranded pool goes with it and the name is free again), every one of AAA Two's
still-active days-off entries is deleted via the API (this file is their sole owner, and since
v3.9.0 there is no status to filter on — a plain `view=own` fetch catches everything, including
anything Manager AAA recorded on AAA Two's behalf), and stranded "E2E correction" rows are
deleted (the run window repeats every 40 minutes, so a later run could otherwise mint a second
correction with an identical comment). The suite thus self-heals on the next run no matter
where a run died.

## Scenario: days off end to end: holiday, allowance, entries, delete, calendar

1. The admin opens Public holidays and adds "E2E Holiday \<Monday\>" on the booked Monday, then
   opens Config → Paid-leave pools and adds the pool kind "E2E Pool \<Monday\>" with "Unused
   days carry over to the next year" unchecked (a yearly-reset pool, v3.2.0).
   - *Expected*: "Public holiday added" (a residual holiday from a failed run answers "A holiday
     already exists on this date." instead — either way the date is now covered), and the
     holiday appears in the list; "Pool kind added" (or, after a sweep race, "A pool kind with
     that name already exists.") and the kind is listed.
2. Manager AAA signs in, opens the Dashboard's subordinates tab, and follows AAA Two's
   "Days off" card link to the per-user drill-down. Beside the default pool strip's Allowance
   figure, the pencil opens the allowance editor; the manager saves 299, reopens the editor,
   and saves 300 (why two saves: the second is an actual change on every rerun — an idempotent
   re-save of 300 would mint no fresh notification later — and the reopened editor's 299
   prefill proves the first save persisted; v2.32.0 moved the allowance from the admin's
   user-edit form to this manager-owned spot). Then "Add pool" grants AAA Two the run's
   "E2E Pool" kind with 3 days (v3.2.0).
   - *Expected*: "Allowance saved" after each save; the reopened editor is prefilled with 299;
     "Pool added", and a second strip named after the pool appears, flagged "resets yearly".
3. AAA Two opens Days off → My days off and books a PAID entry for the holiday week's
   Monday–Tuesday via the header's "New days off" button.
   - *Expected*: the budget card "Your paid days off in \<year\>" is visible and lists the
     granted pool beside the default one; the live cost preview reads "This entry costs 1
     working day." (the Monday holiday is free — the half-day-cost edge); "Days off added"
     confirms; the entry shows up on My days off immediately — no lifecycle to wait through,
     the create IS the entry (v3.9.0).
4. AAA Two books a second entry, a single day on the booked week's Friday, picking the
   "E2E Pool" entry in the Type picker (v3.2.0).
   - *Expected*: the own budget card already lists the granted pool; the cost preview reads
     "1 working day"; "Days off added"; the Friday row names the pool.
5. Manager AAA opens the Dashboard's subordinates tab and looks at AAA Two's card.
   - *Expected*: "Next vacation" with the Monday's date, and "Days-off budget left" — the card
     counts the entry the moment it is created; there is nothing left to accept.
6. AAA One — AAA Two's teammate on team AAA, not their manager — signs in and opens the bell.
   - *Expected*: an "AAA Two added a day off" notification: the create fan-out reaches the
     owner's whole team, not just the direct manager (v3.9.0).
7. AAA Two deletes the Friday pool entry from My days off (the owner's own right).
   - *Expected*: the confirm dialog reads "Delete this days-off entry?" with no reason field
     (deletion carries no lifecycle reasoning, unlike the old mandatory-reason cancel); "Days-off
     entry deleted"; the row disappears; the pool's granted history is unaffected.
8. Manager AAA opens the bell.
   - *Expected*: an "AAA Two deleted a day off" notification — the delete fan-out reaches the
     direct manager the same way create did.
9. On the Calendar tab, AAA Two pages forward to the Monday–Tuesday entry's month.
   - *Expected*: the team days-off calendar marks the still-active Tuesday — "AAA Two — \<date\>:
     Paid days off (1 day)" — no status wording rides the cell title anymore (v3.9.0).
10. Manager CCC — an indirect chain manager (AAA Two reports to Manager AAA, who sits on team
    CCC, Manager CCC's own team) — signs in, opens Days off's Calendar tab, and switches "Whose
    calendar" from the default to "All my reports (including indirect)".
    - *Expected*: AAA Two's row appears in the calendar grid — every scoped person renders a
      row regardless of that month's entries — with her team, "AAA", named beneath her name
      (v3.13.0).
11. Still as Manager CCC, on the My team tab's Reports select, switches from "Direct reports
    only" to "All reports (including indirect)", then filters the entries list to "AAA Two".
    - *Expected*: AAA Two's still-active Monday–Tuesday entry row appears, carrying the "AAA"
      team badge beside her name (v3.13.0) — an indirect report Manager CCC could not otherwise
      see or manage directly.
12. Manager AAA opens Days off, clicks the header's "Record days off" button (the on-behalf
    entry, kept from v2.29.0), picks AAA Two in the "On behalf of" picker, books the booked
    week's Thursday (a PAID single day from the default pool), and clicks "Submit".
    - *Expected*: the cost preview reads "1 working day"; back on Days off with the "Days off
      recorded" toast (no "auto-accepted" wording — there is no acceptance step); the entry
      sits active on the team's Entries list immediately.
13. AAA Two signs in and opens the bell.
    - *Expected*: "Manager AAA added a day off" — the on-behalf entry reached its owner through
      the same team fan-out as any other create, not a dedicated on-behalf receipt (the acting
      manager, being the one who acted, is excluded from their own fan-out and gets no
      self-receipt this time — unlike the pre-v3.9.0 "you recorded on behalf of" notice).
14. Still on the Team tab, Manager AAA switches the team view to **Budgets**, opens "Budget
    corrections of AAA Two" and adds a +2-day correction with the comment
    "E2E correction \<Monday\>".
    - *Expected*: "Correction added", and the correction is listed in the modal.
15. AAA Two signs in, checks the bell, then opens their own Corrections modal from My days off.
    - *Expected*: an "added 2 day(s) to your "Paid days off" budget" notification; the
      correction shows read-only — no "Add correction" form and no per-row actions.
16. Manager AAA (from the Team tab's Entries view) deletes the recorded Thursday entry on
    AAA Two's behalf — the owner-or-chain delete right that replaced the mandatory-reason
    manager-side cancel.
    - *Expected*: "Days-off entry deleted"; the row disappears from the team list; the budget's
      used figure drops back.

**Cleanup** (in-test, through the UI): AAA Two deletes their own remaining Monday–Tuesday entry
from My days off ("Days-off entry deleted"); Manager AAA deletes the correction ("Correction
deleted") and archives AAA Two's "E2E Pool" grant on the drill-down ("Pool archived" — the
default pool has no archive control); the admin archives the pool kind on Config → Paid-leave
pools via the row's ⋯ "More actions" menu ("Pool kind archived") and deletes the holiday from
its table row ("Public holiday deleted") — nothing this run created persists on the seed
accounts or the registries.

## Not covered here (and why)

- **The manager's own on-behalf receipt** (pre-v3.9.0 "You recorded days off on behalf of…")
  is gone by design — the acting manager is excluded from the fan-out they trigger. The scenario
  notes this but does not assert the ABSENCE of a bell card: a negative text assertion against
  the shared, ever-growing notification list is not reliable across parallel/rerun traffic.
- **A separate UNPAID-entry walkthrough** (a single unpaid day alongside the paid ones, proving
  the paid budget stays untouched) is dropped from this rewrite to keep the file focused on the
  lifecycle removal itself — the PAID/UNPAID cost-math parity is exercised by the days-off cost
  unit tests and `DaysOffRoutesTest` (server), not e2e.
