# HR auditor — read-only cross-pair audit

- **Spec**: [tests/hr.spec.ts](../tests/hr.spec.ts)
- **Actors**: the seed admin, Manager AAA (the draft's author), AAA Three (the audited subject —
  never signs in), and a throwaway auditor ("E2E-HR") created through the UI
- **Owns** (exclusive server-side state): the (AAA Three ← Manager AAA) feedback triple — this
  file's exclusively owned pair under parallel workers (an open DRAFT would block any other
  spec's create on the same pair via the no-duplicate invariant); plus the throwaway HR user it
  mints.
- **Since**: v1.25.0 (the HR auditor role), v1.26.0 (management-only ADMIN — no Audit section
  for admins)

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
9. The auditor checks for an admin surface.
   - *Expected*: none — the Config group never offers Alerts to HR.

## Not covered here (and why)

- The full cross-pair read matrix and the `hr.read`/`hr.list` audit-trail events — exhaustively
  covered by the server suite (`HrRoleTest`); this spec walks the real UI path once.
