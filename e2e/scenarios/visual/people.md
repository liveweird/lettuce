# Desktop Dashboard and directory visual candidates

- **Spec**: [people.spec.ts](../../visual/tests/people.spec.ts)
- **Actors**: synthetic member, manager without ADMIN, administrator without managed teams.
- **Owns**: isolated browser contexts and fixed, schema-typed read responses; no server state.
- **Status**: six new candidate images, awaiting human approval before promotion to CI baselines.
- **Scope**: desktop appearance at 1280/1440px, full vertical pages; no mobile, API authorization,
  mutation or real-data correctness claims. Every request must be an explicit fixture.

## Scenario: member dashboard retains its summary tiles and manager cards

1. Open My managers on the Dashboard as an ordinary member at 1440px.
   - *Expected*: personal summary tiles and two manager cards contain the supplied data;
     management summary tiles are absent, the selected tab is correct and fonts have loaded.
2. Compare the full page with its reviewed image.
   - *Expected*: long names, career values, team badges and actions fit horizontally.

## Scenario: member users list retains readable identity and accessible actions

1. Open Users as an ordinary member at 1280px.
   - *Expected*: three supplied users include a long email, a missing unique ID, mixed roles
     and one inactive account. Teams links remain reachable; account modification and New are absent.
2. Compare the populated page with its reviewed image.
   - *Expected*: identity, status and action columns retain their appearance without horizontal overflow.

## Scenario: member teams list retains read-only team and manager links

1. Open Teams as an ordinary member at 1280px.
   - *Expected*: three named teams and manager links appear; New and Edit controls are absent.
2. Compare the full page with its reviewed image.
   - *Expected*: long team and manager names fit the read-only layout.

## Scenario: manager dashboard retains direct-report tiles and populated subordinate cards

1. Open My subordinates on the Dashboard as a manager at 1280px.
   - *Expected*: personal and management tiles render, plus three subordinate cards with mixed
     populated/missing profile values, dates, goals, leave and review data.
2. Compare the populated page with its reviewed image.
   - *Expected*: cards, filters, pagination and actions fit horizontally; normal vertical scrolling is allowed.

## Scenario: administrator users list retains account controls and mixed account states

1. Open Users as an administrator at 1440px.
   - *Expected*: the same three users appear, together with New user, Mass import and each
     user's account-modification menu. No edits are made.
2. Compare the page with its reviewed image.
   - *Expected*: long identity fields, roles, inactive/missing indicators and actions retain their layout.

## Scenario: administrator teams list retains editing actions with long names

1. Open Teams as an administrator at 1440px.
   - *Expected*: three supplied teams appear with their managers, New team and a per-row Edit link.
2. Compare the page with its reviewed image without modifying anything.
   - *Expected*: long labels and administrative action columns fit horizontally.
