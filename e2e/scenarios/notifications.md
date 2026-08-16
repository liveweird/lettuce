# Bell mechanics — seen/unseen, mark all, per-row delete

- **Spec**: [tests/notifications.spec.ts](../tests/notifications.spec.ts)
- **Actors**: Administrator (API setup only), AAA One and AAA Two (requesters), a throwaway
  provider — the notification recipient under test
- **Owns** (exclusive server-side state): the throwaway recipient's bell — the only kind of bell
  where count/badge/mark-all-as-seen assertions are allowed (seed bells receive concurrent
  traffic from other files; this spec is the rulebook's template for that rule) — plus the two
  feedback requests (AAA One → throwaway, AAA Two → throwaway), both rejected at the end

## Scenario: recipient toggles seen/unseen and marks all notifications as seen

1. An administrator creates a throwaway user over the API with a client-supplied password (no
   reveal-modal round-trip needed). Why a throwaway: "Mark all as seen" and the "0 unread" badge
   need a bell no other spec or parallel worker can mint notifications into.
2. AAA One signs in, finds the throwaway on the Users list, asks them for feedback ("Ask for
   feedback" → "Send request"), and signs out.
3. AAA Two does the same. Why one ask per requester: a second ask with the same
   (subject, provider, requester) triple would be blocked by the no-duplicate constraint (v1.13),
   so two different requesters yield the two fresh unseen notifications.
4. The throwaway provider signs in and opens the notification bell.
   - *Expected*: the card "AAA One requested feedback about AAA One." is visible.
5. They mark that notification as seen.
   - *Expected*: the row restyles — it now offers "Mark as unseen" and no longer "Mark as seen".
6. They mark it back as unseen.
   - *Expected*: the "Mark as seen" action is offered again.
7. They press "Mark all as seen".
   - *Expected*: the bulk "Mark all as seen" button disappears and no per-notification
     "Mark as seen" action remains. (Safe against parallel workers precisely because this bell
     belongs to the throwaway alone.)
8. They delete the AAA One notification.
   - *Expected*: its card disappears; the sibling card "AAA Two requested feedback about
     AAA Two." stays — deletion is per-row, not a bulk clear.
9. They close and reopen the bell.
   - *Expected*: the deleted notification is gone for good (the deletion survives a reopen).
10. They close the bell.
    - *Expected*: the bell badge reads 0 unread.
11. Tidy-up: the provider opens each of the two requests in the triage editor and rejects it,
    confirming the dialog. Why: a mid-run death before this point strands open requests on the
    throwaway only — never on a seed pair.
