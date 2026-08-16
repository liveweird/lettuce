# Forgot-password reset

- **Spec**: [tests/password-reset.spec.ts](../tests/password-reset.spec.ts)
- **Actors**: an anonymous visitor; the seed administrator (setup only); a throwaway user
  ("E2E-Reset …") created through the UI
- **Owns** (exclusive server-side state): the throwaway user and only that user's Mailpit inbox;
  the per-email reset throttle for two `e2e-reset-*@lettuce.local` addresses no other spec uses
- **Since**: v1.3

## Scenario: the forgot-password link leads to the reset form; unknown emails get the neutral answer

1. A visitor on the login screen clicks the **Forgot password?** link.
   - *Expected*: the reset-password page opens, with its **Send new password** button.
2. The visitor submits a unique, unknown email address.
   - *Expected*: the neutral "if an account with this address exists…" answer — account
     existence is never disclosed.
3. The visitor requests a reset for the same (fixed) address twice within a minute.
   - *Expected*: the first request gets the neutral answer; the second is throttled with a
     clear "only one reset request per minute" message.

## Scenario: a reset email delivers a working new password and kills the old one

0. *Precondition*: requires the Mailpit mail catcher (the compose stack); skipped otherwise —
   the email roundtrip is untestable without it (e.g. a dev stack on the log transport).
1. The admin signs in, creates a throwaway user via the admin **Create** form (noting the
   revealed one-time password), and logs out.
2. On the reset-password page, the throwaway user's email is submitted.
   - *Expected*: the same neutral "if an account with this address exists…" answer.
3. A reset email arrives in the user's Mailpit inbox (delivery is asynchronous), containing a
   generated 16-character password.
4. The user signs in with the new password from the email, then logs out.
   - *Expected*: the new password works.
5. The user attempts to sign in with the *old* (original) password.
   - *Expected*: the "invalid email or password" rejection — the old password no longer works.
     (Asserted as the server's actual credential verdict: a rate-limited attempt is resubmitted
     rather than mistaken for the rejection.)
