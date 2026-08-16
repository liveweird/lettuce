# Welcome email on admin create

- **Spec**: [tests/welcome-email.spec.ts](../tests/welcome-email.spec.ts)
- **Actors**: the seed administrator; a throwaway user ("E2E-Welcome …") created through the UI
- **Owns** (exclusive server-side state): the throwaway user and only that user's Mailpit inbox
  (messages matched by recipient + the "Your Lettuce account is ready" subject, so a shared
  Mailpit inbox never matches another spec's message)

## Scenario: creating a user with the email option delivers working credentials

0. *Precondition*: requires the Mailpit mail catcher (the compose stack); skipped otherwise —
   the email roundtrip is untestable without it.
1. The admin signs in and creates a throwaway user via the admin **Create** form, this time
   checking **Email the credentials to the new user**.
   - *Expected*: the confirmation dialog notes that the credentials have been emailed to the
     new user, and reveals the generated one-time password behind **Show password**.
2. The admin logs out. A welcome email ("Your Lettuce account is ready") arrives in the new
   user's Mailpit inbox (delivery is asynchronous), containing a 16-character password.
   - *Expected*: the emailed password is the same one the reveal modal showed.
3. The new user signs in through the real login form with the emailed password.
   - *Expected*: the sign-in works — the header account menu is visible.

## Not covered here (and why)

- The email-less create path — `users-import.spec.ts` deliberately runs the mass import
  **without** the email option; this spec complements it.
