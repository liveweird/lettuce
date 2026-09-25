# Microsoft Teams notifications

- **Spec**: [tests/teams-notifications.spec.ts](../tests/teams-notifications.spec.ts)
- **Actors**: the seed administrator (enables the flag; API setup); throwaway users ("E2E Teams
  …" / "E2E teams-not-installed …") minted over the API, one per scenario
- **Owns** (exclusive server-side state): each scenario's own throwaway user, and only the
  `teams-stub` journal entries naming that user's email — the stub derives the Entra object id
  and the conversation id from the email, so no other spec's traffic can match
- **Needs**: the compose stack's `teams-stub` (WireMock, `http://localhost:8089`) AND an app
  under test whose `teams.transport` points at it; both scenarios skip when the stub is
  unreachable or when, once the flag is on, the app reports `teamsAvailable: false`
- **Since**: v4.5.0

## Scenario: an admin switches Microsoft Teams on for a user, the Teams column appears, and a notification arrives as a Teams direct message

1. A throwaway user ("the owner") is minted over the API, signs in and opens **Notification
   preferences** from the header account menu.
   - *Expected*: the matrix shows the In app column but no **Microsoft Teams** column — the flag
     is opt-in and starts off.
2. The owner signs out. The administrator signs in, opens the owner's per-user features editor
   and turns **Microsoft Teams notifications** on, then saves.
   - *Expected*: the switch starts off; saving returns to the users list.
3. The administrator signs out; the owner signs in and reopens **Notification preferences**.
   - *Expected*: a **Microsoft Teams** column is there; "My password was changed" is on and
     cannot be switched off (the locked security receipt).
4. The owner signs out and changes their own password (over the API).
   - *Expected*: within a few seconds the stub's journal holds, for the owner: a directory
     lookup by their email, a conversation created for the resolved id, and a message activity
     whose text contains "Your password was changed."

## Scenario: a user the Teams app was never installed for gets no Teams message, while the notification still reaches the bell

1. A throwaway user whose email names "teams-not-installed" is minted, and the administrator
   enables the Teams flag for them over the API.
2. The user changes their own password (over the API).
   - *Expected*: the stub's journal holds a conversation attempt for them answered 403 (the
     Teams "app not installed" refusal) and no message activity at all.
3. The user signs in with the new password and opens the notifications bell.
   - *Expected*: "Your password was changed." is there — the unreachable Teams channel never
     costs the in-app one.
