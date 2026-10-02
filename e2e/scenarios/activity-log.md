# Activity log — own, report, auditor and refused views

- **Spec**: [tests/activity-log.spec.ts](../tests/activity-log.spec.ts)
- **Actors**: Administrator (API setup only) and five throwaway users — an employee E, E's manager
  M (in a new E2E team), an unrelated peer P and an HR auditor H (created with the HR role)
- **Owns** (exclusive server-side state): the five throwaway users, the E2E team (M manages E) and
  one feedback from E about M (`PROVIDER_SUBJECT` visibility, drafted then sent). Nothing else in
  the suite touches any of them; the residue sweep removes the users and the team. The sign-in
  history rows the logins mint live on those users only.
- **Since**: v4.9.0

## Scenario: a manager sees only the readable part of a report's activity log, HR sees all, a peer is refused

1. Setup over the API as the administrator: the five users, the team (M manages E), and E's
   DRAFT feedback about M. Why a draft with `PROVIDER_SUBJECT`: until it is sent only E can read
   it, and once sent M — its subject — can, so one document proves both the hiding and the reveal.
2. E signs in through the form and opens "My activity".
   - *Expected*: the page is titled "My activity"; the log holds a "Signed in" row and the row
     "Feedback created as a draft.", whose document label ("From <E> to <M>") links to the feedback.
     E signs out.
3. M signs in, opens the dashboard's subordinates tab and presses E's "Activity log" icon.
   - *Expected*: the page is titled "Activity — <E>"; the "Signed in" row is listed, the draft row
     is NOT, and no Feedback area appears at all — the entry is hidden, not blanked or counted,
     because M cannot read an undelivered draft in their own right. M signs out.
4. H signs in, opens E's user details from the Users list and follows "Audit the activity log".
   - *Expected*: the auditor page ("The auditor view: everything <E> did …") lists the draft row as
     well as the sign-in — HR reads everything. H signs out.
5. E signs in again, opens the feedback's editor and presses "Save & send", then opens "My activity".
   - *Expected*: the new row "Status changed from Draft to Sent." is in E's log. E signs out.
6. M opens E's activity log again.
   - *Expected*: both feedback rows ("Feedback created as a draft." and "Status changed from Draft
     to Sent.") are now listed — M is the subject of a delivered feedback, a reader in their own
     right. M signs out.
7. P — outside E's management chain — opens E's user details.
   - *Expected*: no "Activity log" button is offered. Opening E's activity URL directly answers
     with the permission message "You don't have permission to view this activity log." and no
     feedback row is shown.

## Not covered here (and why)

- The other areas (goals, 1:1s, reviews, KPIs, impact log, succession, shares, days-off, career
  rows), their per-area visibility rules, retention and the ordering tie-breaks — covered by the
  server's `ActivityLogTest`/`ActivityVisibilityParityTest` and the SPA's vitest cases
  (`describeActivity.test.ts`, `ActivityLog.test.tsx`, `UserActivity.test.tsx`); one browser
  journey over the feedback kind proves the three flavors and the access wiring end to end.
