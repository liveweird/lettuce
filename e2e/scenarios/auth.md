# Login and logout

- **Spec**: [tests/auth.spec.ts](../tests/auth.spec.ts)
- **Actors**: the seed administrator (`admin@lettuce.local`)
- **Owns** (exclusive server-side state): nothing — read-only (sessions only; no seeded account is
  ever mutated)

## Scenario: admin can log in and log out

1. The admin signs in through the real login form — email, password, "Sign in". This spec is the
   one deliberate opt-out from the API-minted-session fast path: it exists to exercise the form
   itself.
   - *Expected*: the app shell is up — the header account menu is visible.
2. The admin navigates to the home page.
   - *Expected*: the **Dashboard** heading is visible.
3. The admin opens the account menu and chooses **Logout**.
   - *Expected*: they are back on the login screen — the **Sign in** button is visible.

## Scenario: invalid credentials are rejected

1. A visitor submits the login form with the admin's email and a wrong password.
   - *Expected*: the "invalid email or password" rejection is shown. The assertion insists on
     the server's actual credential verdict, not a rate-limit answer — the spec runs early,
     right after the global-setup cleanup logins have strained the per-IP login bucket, so a
     rate-limited attempt is resubmitted until the credentials are genuinely evaluated.

## Not covered here (and why)

- **Login lockout (429)** — five failed logins would lock a seeded account for 15 minutes in the
  shared database and poison the rest of the run. Covered by `LoginThrottleTest` /
  `LoginLockoutTest` (server).
- **Token refresh / expiry** — needs clock control; covered by server tests and the
  `web/src/api/api.test.ts` unit tests.
