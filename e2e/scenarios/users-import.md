# Mass CSV user import

- **Spec**: [tests/users-import.spec.ts](../tests/users-import.spec.ts)
- **Actors**: the seed admin (`admin@lettuce.local`); imported throwaway accounts under
  run-unique email slugs; seed user AAA One's email reused as the duplicate row (read-only —
  the duplicate is skipped, never mutated)
- **Owns** (exclusive server-side state): only the prefix-unique accounts it imports (this
  file's tests are order-dependent, which is fine — the spec file is the serial unit)
- **Since**: v1.4 (mass user import)

## Scenario: a mixed CSV imports row-by-row and an imported password signs in

1. The admin signs in, opens the Users list, and follows **Mass import**.
   - *Expected*: the import page opens.
2. The admin uploads a CSV containing: a header line, a plain row, a row whose **name contains a
   comma** ("Kowalski, Jan"), a row reusing a **seeded user's email**, a **comma-less** line, and
   a blank line — then clicks **Import**.
   - *Expected*: the per-row summary reads "Created: 2 · Duplicates: 1 · Errors: 1"; the
     seed-email row is marked "Duplicate — skipped"; the comma-less line is marked "Parse
     error"; the comma-in-name row kept "Kowalski, Jan" intact (the name splits on the LAST
     comma).
3. The admin looks at a created row's one-time password.
   - *Expected*: masked by default.
4. The admin clicks the row's **Show password**.
   - *Expected*: a 16-character generated password is revealed.
5. The admin follows **Back to users** and signs out.
   - *Expected*: back on the users list.
6. The imported user signs in with the revealed one-time password.
   - *Expected*: the imported credentials work.

## Scenario: re-importing the same rows yields duplicates, not new accounts

1. The admin signs in and imports a single-row CSV with a fresh run-unique email.
   - *Expected*: "Created: 1 · Duplicates: 0 · Errors: 0".
2. The admin imports the exact same file again.
   - *Expected*: "Created: 0 · Duplicates: 1 · Errors: 0" — no second account is created.

## Not covered here (and why)

- The **email option** (mailing each imported user their credentials) is deliberately not
  exercised, so the journey works on any stack regardless of mail transport.
