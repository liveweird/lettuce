# 1:1 meetings — documenting, carry-over, and the subordinate's view

- **Spec**: [tests/one-on-ones.spec.ts](../tests/one-on-ones.spec.ts)
- **Actors**: Manager AAA (the meeting author), AAA Three (the direct report — the least-used
  seeded pair)
- **Owns** (exclusive server-side state): the 1:1 meetings it creates between Manager AAA and
  AAA Three — unique-worded entries, and every scenario deletes the meetings it creates; seeded
  accounts are never mutated

## Scenario: a manager documents a 1:1 (points, decisions, action items), views it, and deletes it

1. Manager AAA signs in and starts a new meeting ("New 1:1") with team member AAA Three, dated
   today.
   - *Expected*: creating lands directly on the meeting's edit screen.
2. On the edit screen they document the meeting: add one discussed point, one decision, and one
   action item (each unique-worded — the shared database is never reset; the action item goes into
   the last entry slot, since carry-over from earlier runs may already occupy leading positions),
   then Save.
3. They open the meeting's read-only view.
   - *Expected*: the point, the decision, and the action item are all shown.
4. They open the 1:1 list's managed tab.
   - *Expected*: the meeting is listed with an edit link.
5. They delete the meeting from its edit screen, confirming "Delete this 1:1 meeting?".
   - *Expected*: the meeting no longer appears anywhere on the managed tab.

## Scenario: open action items carry over to the next 1:1 and the subordinate is notified

1. Manager AAA signs in and documents a first meeting with AAA Three containing one unresolved
   action item.
2. They create a second meeting with the same person.
   - *Expected*: the open item is carried over automatically at creation — the edit screen shows a
     "Carried over" badge, and the second meeting's read-only view contains the item's text.
3. The manager signs out; AAA Three signs in and opens the notification bell.
   - *Expected*: a notification that Manager AAA documented a 1:1 meeting with them.
4. AAA Three opens their own 1:1 list.
   - *Expected*: the meeting is there with a **view** link only — no edit affordance for the
     subordinate — and its read-only view shows the carried-over action item.
5. Cleanup: the subordinate signs out; Manager AAA signs back in and deletes both meetings.
   - *Expected*: neither meeting remains on the managed tab.
