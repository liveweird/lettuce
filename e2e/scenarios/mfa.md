# Email MFA at login

- **Spec**: [tests/mfa.spec.ts](../tests/mfa.spec.ts)
- **Actors**: the seed administrator; a throwaway user ("E2E-Mfa …") created through the UI
- **Owns** (exclusive server-side state): the throwaway user and only that user's Mailpit inbox
  (messages matched by recipient + subject). Seeded accounts stay MFA-off (the V52 default), so
  no other spec's login path is touched.
- **Since**: v2.4.0

## Scenario: an MFA-enabled user must enter the emailed code; a wrong code is rejected inline

0. *Precondition*: requires the Mailpit mail catcher (the compose stack); skipped otherwise —
   the email roundtrip is untestable without it.
1. The admin signs in and creates a throwaway user via the admin **Create** form, noting the
   generated one-time password from the reveal modal.
2. The admin opens the throwaway user's per-user features editor.
   - *Expected*: the **MFA (email sign-in code)** switch is off — MFA is opt-in by
     (inverted) default.
3. The admin turns the MFA switch on and clicks **Save**.
   - *Expected*: back on the Users list.
4. The admin logs out. The throwaway user signs in through the real login form with their
   correct email and password.
   - *Expected*: instead of the dashboard, the **Enter your sign-in code** step appears,
     showing the user's email address.
5. A sign-in-code email arrives in the user's Mailpit inbox (delivery is asynchronous),
   containing the 6-digit code.
6. The user types a *wrong* 6-digit code and clicks **Verify**.
   - *Expected*: an inline "invalid or expired code" error; still on the code step (the server
     answers a uniform 401 for every failure mode).
7. The user submits four more wrong codes (five failures total — the attempt cap).
   - *Expected*: the same uniform "invalid or expired code" wording every time — whether a
     code was wrong or the cap is hit lives only in the server's audit log (2026-08 audit
     round).
8. The user enters the CORRECT code from the email and clicks **Verify**.
   - *Expected*: still rejected with the same wording — the cap killed the challenge;
     a spent challenge never accepts a code.
9. The user returns to the login form and signs in again with the same credentials.
   - *Expected*: a fresh code step; a NEW sign-in-code email (a different code) arrives in
     Mailpit.
10. The user enters the fresh code and clicks **Verify**.
    - *Expected*: the sign-in completes — the header account menu is visible.
11. The user logs out.
