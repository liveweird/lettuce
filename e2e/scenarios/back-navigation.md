# Back / Cancel return navigation — the origin survives every hop

- **Spec**: [tests/back-navigation.spec.ts](../tests/back-navigation.spec.ts)
- **Actors**: Manager AAA (badge, My teams and create legs), AAA One (org-chart leg) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only; the create screens are cancelled
  untouched and every test asserts that no non-GET API request was issued
- **Since**: v4.6.0 (shared person/team links carry the page they were clicked on as `back=`; the
  create screens' `cancel=`; the team pages pass their origin along every outgoing link)

## Scenario: a dashboard team badge returns to the tab it was clicked on

1. Manager AAA signs in and opens the Dashboard's "My managers" tab.
2. They click a team badge on a manager's card (team CCC, where Manager AAA is a member).
   - *Expected*: the team-details page opens.
3. They use the "Back to My managers" link.
   - *Expected*: they are back on the Dashboard's My managers tab — the label names the tab they
     came from (never "Teams"), and no write request was issued.

## Scenario: a team opened from the org chart keeps its origin through a roster person and the per-person feedback list

1. AAA One signs in, opens the Org chart and clicks the "Members of AAA" node.
   - *Expected*: team AAA's details page opens (marked as opened from the org chart).
2. They click a roster person (AAA Two) and then "Back to Team members".
   - *Expected*: the person's read-only card opens, then they are back on team AAA's page still
     marked as opened from the org chart.
3. They use "Back to Org chart".
   - *Expected*: they are on the Org chart.
4. They open the team again, open the roster row's Feedback menu for AAA Two and pick "Feedbacks
   with AAA Two", then use "Back to Team members" and "Back to Org chart".
   - *Expected*: the per-person feedback list returns to the team page with its org-chart origin
     intact, and from there to the Org chart. No write request was issued.

## Scenario: the team KPI list keeps the My teams origin of the team page it was opened from

1. Manager AAA signs in, opens the Dashboard's "My teams" tab and clicks the team name "AAA".
   - *Expected*: the team-details page opens, marked as opened from My teams.
2. They click the page's "Team KPIs" button.
   - *Expected*: the team's KPI list opens ("Team KPIs of AAA"), its address carrying the team
     origin and the team page's own address as the return target.
3. They use "Back to AAA".
   - *Expected*: they are back on the team page, still marked as opened from My teams.
4. They use "Back to My teams".
   - *Expected*: they are on the Dashboard's My teams tab. No write request was issued.

## Scenario: Cancel on a create screen returns to where it was opened from

1. Manager AAA opens Goals on the "Own" tab and clicks the header's "New goal", then "Cancel".
   - *Expected*: they return to the Own tab — not the Managed tab where a saved goal would land.
2. They open the Users list filtered to AAA One, open the row's Feedback menu, pick "Provide
   feedback for AAA One" and then "Cancel" on the untouched form.
   - *Expected*: they return to the Users list, not the Dashboard. No write request was issued.

## Not covered here (and why)

- The other create screens' Cancel (1:1, impact entry, succession plan, team KPI, days off,
  feedback from the Feedback hub) and the duplicate-warning links — the same `cancel=`/`back=`
  reading, covered page by page in the web unit tests (`Create*.test.tsx`, `Feedback.test.tsx`).
- Hostile `back=`/`cancel=` values (protocol-relative, slash-backslash) — unit-tested in
  `web/src/utils/url.test.ts` and on each page that reads them.
