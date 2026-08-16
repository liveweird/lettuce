# Email-mirror opt-out

- **Spec**: [tests/email-notifications.spec.ts](../tests/email-notifications.spec.ts)
- **Actors**: the seed administrator (API setup only); a throwaway user ("E2E Mail Pref …")
  minted over the API
- **Owns** (exclusive server-side state): the throwaway user and their email-mirror flag —
  seeded accounts are never mutated, and a mid-run death strands nothing other specs read
  (the flag only matters at email-send time)
- **Since**: v2.3.0

## Scenario: a user opts out of email notifications from the account menu and opts back in

1. A throwaway user is minted over the API (setup, not the journey under test) and signs in.
2. The user opens the header account menu and chooses **Email notifications** — the screen's
   only entry point. (Any active alert banner overlaying the header is hidden first, as a user
   would.)
   - *Expected*: the self-service email-notifications screen opens; the **Send me an email for
     every notification** switch is on — the default is mirror-on.
3. The user turns the switch off and clicks **Save**.
   - *Expected*: the "Email notification settings saved" toast appears and the app returns to
     the home page.
4. The user reopens the screen through the account menu.
   - *Expected*: the switch is still off — the choice survived the save and the reopen.
5. The user turns the switch back on and clicks **Save**.
   - *Expected*: the same toast and redirect home.
6. The user reopens the screen once more.
   - *Expected*: the switch is on again — opting back in persisted too.
