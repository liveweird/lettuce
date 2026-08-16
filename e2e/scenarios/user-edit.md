# Admin creates and renames a user

- **Spec**: [tests/user-edit.spec.ts](../tests/user-edit.spec.ts)
- **Actors**: the seed admin (`admin@lettuce.local`); one throwaway user with a run-unique name
  and email
- **Owns** (exclusive server-side state): only the throwaway user it creates — it never mutates a
  seeded account other specs reference by name

## Scenario: admin creates then renames a user

1. The admin signs in and opens the new-user form.
2. The admin fills a run-unique name and email and clicks **Create** — the form has no password
   fields: the password is generated and revealed once in a confirmation modal.
   - *Expected*: the user is created and the one-time generated-password reveal modal appears.
3. The admin dismisses the reveal modal.
4. The admin opens the new user's edit form, replaces the name with a second run-unique name, and
   clicks **Save**.
5. The admin reopens the edit form.
   - *Expected*: the Name field holds the new name — the rename persisted.

## Not covered here (and why)

- Everything beyond create/rename — role changes, the two password-change flows,
  deactivate/reactivate, delete, the reveal modal's mask/show/hide mechanics — is the sibling
  journey in `users-admin.spec.ts`.
