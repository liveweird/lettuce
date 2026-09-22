# Per-type notification preferences

- **Spec**: [tests/notification-preferences.spec.ts](../tests/notification-preferences.spec.ts)
- **Actors**: the seed administrator (API setup only); the seeded `AAA_ONE` account (triggers
  the second actor's actions); throwaway users ("E2E Notif Prefs …" / "E2E Notif Master …")
  minted over the API, one per scenario
- **Owns** (exclusive server-side state): each scenario's own throwaway user and the feedback/
  kudo rows it creates against them — seeded accounts are never mutated, and a mid-run death
  strands nothing other specs read
- **Since**: v4.0.0

## Scenario: a user turns off in-app for one type so a second actor's action mints no bell row while another type still arrives

1. A throwaway user ("the owner") is minted over the API (setup, not the journey under test) and
   signs in.
2. The owner opens the header account menu and chooses **Notification preferences**.
   - *Expected*: the matrix opens; the "Someone requests feedback from me" row's **In app**
     switch is on — the default.
3. The owner turns that one switch off and clicks **Save**.
   - *Expected*: the "Notification preferences saved" toast appears and the app returns to the
     home page.
4. The owner signs out. `AAA_ONE` signs in, asks the owner for feedback (the same request shape
   the bell-mechanics journey uses), and separately sends the owner a kudo from the Kudos wall's
   "New kudo" screen — two different notification types minted for the owner.
   - *Expected*: both requests succeed.
5. `AAA_ONE` signs out; the owner signs back in and opens the notifications bell.
   - *Expected*: the kudo's "has been sent" row is visible first (proving the list has finished
     loading — the type the owner left on still arrives), and only then: no row mentions a
     feedback request ("requested feedback about") — the muted type never minted a bell row.

## Scenario: the master email switch round-trips from notification preferences, and an admin edits another user's

1. A throwaway user ("the owner") is minted over the API and signs in, then opens **Notification
   preferences** from the account menu.
   - *Expected*: the **Send me emails** master switch is on — the default.
2. The owner turns the master switch off and clicks **Save**.
   - *Expected*: the saved toast appears and the app returns home.
3. The owner reopens the screen.
   - *Expected*: the master switch is still off, and the whole email column — for example the
     "Someone requests feedback from me" row's **Email** switch — is now disabled (greyed out).
4. The owner turns the master switch back on and clicks **Save**.
   - *Expected*: the saved toast appears again; opting back in persisted too.
5. The owner signs out; the administrator signs in and opens the SAME user's notification
   preferences by its URL (the admin-for-another-user branch of the self-or-admin rule).
   - *Expected*: the screen shows the target's email with the master switch on.
6. The admin turns the master switch off and clicks **Save**.
   - *Expected*: the toast appears and the app returns to the **Users list** (not home — the
     admin-editing-someone-else return target); reopening the URL shows the switch off.
