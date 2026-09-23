# HR auditor — read-only cross-pair audit

- **Spec**: [tests/hr.spec.ts](../tests/hr.spec.ts)
- **Actors**: the seed admin, Manager AAA (the draft's author), AAA One and AAA Three (audited
  subjects — never sign in), a throwaway auditor ("E2E-HR") created through the UI, and the
  seeded `hr@lettuce.local` HR demo account (v4.1.0, development-mode bootstrap seed)
- **Owns** (exclusive server-side state): the (AAA Three ← Manager AAA) feedback triple — this
  file's exclusively owned pair under parallel workers (an open DRAFT would block any other
  spec's create on the same pair via the no-duplicate invariant); plus the throwaway HR user it
  mints. The second scenario is read-only — nothing else.
- **Since**: v1.25.0 (the HR auditor role), v1.26.0 (management-only ADMIN — no Audit section
  for admins), v3.24.0 (the four remaining drill-downs + the read-only budget in the days-off
  audit view), v4.1.0 (the seeded `hr@lettuce.local` HR demo account)

**Cleanup**: the probe DRAFT is deleted via the API after the test, even on failure, so the
pair is freed for later runs.

## Scenario: an HR auditor browses another pair's private draft read-only

1. The admin creates a throwaway user through the UI (generated password revealed) and grants
   them the HR role on the user's edit screen.
   - *Expected*: the role change saves.
2. The admin opens AAA Three's user-details page.
   - *Expected*: no Audit section is offered — since v1.26.0 ADMIN is a management-only role.
3. Manager AAA writes a private DRAFT feedback about AAA Three, with a unique probe text, and
   saves it as a draft (why: a draft is invisible to everyone but its provider and HR — the
   strongest possible audit-read proof).
4. The auditor signs in with their generated password and opens AAA Three's user-details page.
   - *Expected*: the Audit section IS offered.
5. The auditor opens "Audit feedbacks of AAA Three", viewing the list newest-first (why: the
   persistent dev volume accumulates feedback rows for this seed pair across runs, so under the
   default sort the fresh probe would eventually fall off page 1).
   - *Expected*: the "All feedbacks of AAA Three" list shows the foreign DRAFT with its
     unredacted preview; the row offers View only — never Edit.
6. The auditor opens the record.
   - *Expected*: the draft's content is readable; Close is the only action — the write
     affordances (Send / Withdraw / Delete) are absent; Close round-trips back to the audit
     list.
7. Via "Back to User details", the auditor opens the 1:1-meetings and goals audit lists the
   same way.
   - *Expected*: "All 1:1 meetings of AAA Three" and "All goals of AAA Three" load in audit
     mode (their content may be empty on a fresh volume — reaching each list is the
     assertion).
8. Back on the details card, the auditor opens "Career progression of AAA Three" (2026-08
   audit round — the positive twin of user-career.spec's refused direct URL).
   - *Expected*: the "Career progression — AAA Three" page loads — the career timeline is a
     guarded HR read since v2.25.0 (self/chain/HR only).
9. Via "Back to User details" each time, the auditor opens the remaining four drill-downs —
   performance reviews, days off, the impact log and succession plans (v3.24.0: until then this
   walk stopped at goals, and those four were pinned server-side only).
   - *Expected*: "All performance reviews of AAA Three", "Days off of AAA Three", "Impact log —
     AAA Three" and "Succession plans of AAA Three (audit)" each load in audit mode. Their
     content belongs to other specs, so reaching each list is the assertion — never a row count.
   - *Expected* on the days-off one (v3.24.0): the person's paid-leave BUDGET renders above the
     entries ("Paid days off of AAA Three in <year>") — the auditor could already read the
     corrections but not the budget they adjust — and it is read-only: no Add pool, no Archive,
     no allowance edit, no Add a correction.
10. From the nav, the auditor opens Team KPIs and switches to the "All teams" tab, then goes
    Config -> Teams -> AAA (a team they neither manage nor belong to) and follows its
    "Team KPIs" link (v3.24.0: HR could read any KPI record by id before, but nothing listed
    or linked them).
    - *Expected*: the hub offers the auditor-only "All teams" tab with its org-wide hint; the
      team page opens with the auditor hint and no "New team KPI" entry point. Which rows
      appear belongs to other specs — the KPI data rule (an auditor lists another team's KPIs
      at every status, a manager/ADMIN gets 403) is pinned in the server suite.
11. The auditor opens Days off and switches the calendar's "Whose calendar" picker to
    "All teams (auditor)" (v3.25.0: before it, an auditor who belongs to no team and manages
    nobody saw a calendar containing only themselves).
    - *Expected*: the auditor-only scope is offered, picking it asks the server for
      `scope=org`, and a team narrowing picker appears beside it. Who is off that month is
      demo-volume state other specs own, so it is not asserted here — the data rule is pinned
      in `DaysOffRoutesTest`.
12. The auditor checks for an admin surface.
   - *Expected*: none — the Config group never offers Alerts to HR.

## Scenario: the seeded HR demo account reaches the Audit section with no admin surface

1. The seeded HR demo account (`hr@lettuce.local`) signs in and opens the users list filtered to
   AAA One.
   - *Expected*: no "Modify actions for AAA One" button is offered — the account is HR only,
     never ADMIN.
2. The auditor opens AAA One's user-details page.
   - *Expected*: AAA One's details render, and the Audit section is offered.
3. The auditor checks for an admin surface.
   - *Expected*: none — the Config group never offers Alerts to HR.

## Not covered here (and why)

- The full cross-pair read matrix and the `hr.read`/`hr.list` audit-trail events — exhaustively
  covered by the server suite (`HrRoleTest`); this spec walks the real UI path once.
