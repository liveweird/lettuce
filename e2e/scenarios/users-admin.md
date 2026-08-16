# Admin user management — passwords, roles, deactivation, delete

- **Spec**: [tests/users-admin.spec.ts](../tests/users-admin.spec.ts)
- **Actors**: the seed admin (`admin@lettuce.local`); throwaway users created through the real UI
  (`E2E-Reveal` / `E2E-Role` / `E2E-Pass` / `E2E-Deact` / `E2E-Delete`), each signing in with real
  credentials where the credential itself is the subject
- **Owns** (exclusive server-side state): only the throwaway users it creates — seeded accounts
  that other specs log in with are never mutated
- **Since**: v1.24.1 (the role pill's accessibly named remove button), v1.52.0
  (deactivate/reactivate via the user row's Modify ▾ menu)

## Scenario: the one-time password is masked until revealed, and hides again

1. The admin signs in and opens the new-user form, fills a unique name and email, and clicks
   **Create**.
   - *Expected*: a confirmation dialog shows the generated one-time password fully masked
     (asterisks only).
2. The admin clicks **Show password**.
   - *Expected*: the actual 16-character generated password is revealed.
3. The admin clicks **Hide password**.
   - *Expected*: the password is masked again.
4. The admin closes the dialog.

## Scenario: admin grants and revokes the Admin role

1. The admin signs in and creates a throwaway user through the UI.
2. On the user's edit form, the admin picks **Admin** in the Roles field (a new user starts with
   no additional roles) and clicks **Save**.
3. The admin reopens the edit form.
   - *Expected*: the Admin role pill is shown — the grant persisted.
4. The admin removes the role via the pill's remove button ("Remove role Admin").
   - *Expected*: the pill disappears immediately.
5. The admin clicks **Save**, then reopens the edit form once more.
   - *Expected*: the Roles field is back and no Admin pill remains — the revoke persisted.

## Scenario: admin resets a password; the user then changes their own (current password required)

1. The admin signs in and creates a throwaway user; the admin signs out and the user signs in
   with the generated password from the reveal modal.
   - *Expected*: the generated password works.
2. The user signs out; the admin signs in and opens the user's Change password screen.
   - *Expected*: there is **no "Current password" field** — an admin resetting another user's
     password does not need it.
3. The admin fills New password + Confirm password with a reset password and clicks
   **Change password**, then signs out.
4. The user signs in with the reset password.
   - *Expected*: the reset password works.
5. On their own Change password screen, the user enters a **wrong** current password plus a new
   password and clicks **Change password**.
   - *Expected*: the inline error "The current password is incorrect." — the change is refused.
6. The user re-enters the **correct** current password and submits again.
   - *Expected*: the change goes through.
7. The user signs out and tries the previous (reset) password.
   - *Expected*: rejected — only the self-chosen password signs in.

## Scenario: admin deactivates a user; the account cannot sign in until reactivated

1. The admin signs in and creates a throwaway user; on the Users list the admin filters by the
   user's email (the shared long-lived database — never assume the row sits on page 1).
2. From the row's **Modify ▾** menu the admin chooses "Deactivate ‹name›" and confirms in the
   modal.
3. The admin reloads the Users list and filters by the email again.
   - *Expected*: the row carries the **Inactive** badge.
4. The admin signs out; the user tries to sign in with their **correct** credentials.
   - *Expected*: sign-in is rejected with the distinct "this account has been deactivated"
     message — not the generic invalid-credentials one.
5. The admin signs back in, filters to the row, and chooses **Modify ▾ → "Reactivate ‹name›"**.
6. The admin signs out; the user signs in with the same credentials.
   - *Expected*: access is restored — the sign-in succeeds.

## Scenario: admin deletes a user; the deleted account can no longer sign in

1. The admin signs in, creates a throwaway user, filters the Users list by the user's email, and
   chooses **Modify ▾ → "Delete ‹name›"**, confirming in the modal.
2. The admin loads the Users list fresh and filters by the email again.
   - *Expected*: "No users" — the account is gone from the list.
3. The admin signs out; the deleted account tries its credentials.
   - *Expected*: sign-in is rejected.

## Not covered here (and why)

- **Create + rename** are the sibling journey in `user-edit.spec.ts` — this file deliberately
  covers admin user management *beyond* create/rename.
- **Login lockout (429)** stays a server-test concern suite-wide: five failed logins would lock
  an account for 15 minutes in the shared database.
