# Dashboard "My teams" tab — team view and drill-down round-trip

- **Spec**: [tests/dashboard-my-teams.spec.ts](../tests/dashboard-my-teams.spec.ts)
- **Actors**: Manager AAA (the manager leg), AAA One (the non-manager leg) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only; no data is created or mutated, so
  seeded accounts are untouched
- **Since**: v1.20.0 (the My teams tab), reshaped v2.5.5 (the adaptive team-details page with the
  per-team subordinates grid), v1.51.0 (New 1:1 lives in the card's 1:1 dropdown)

## Scenario: a manager walks My teams into the team view and a drill-down round-trips back

1. Manager AAA signs in and opens the Dashboard's "My teams" tab.
   - *Expected*: team AAA is listed; team CCC is not — the tab shows only the teams the caller
     *manages* (Manager AAA manages exactly AAA and is a mere member of CCC).
2. They click the team name "AAA".
   - *Expected*: the adaptive team-details page opens ("Team details" heading, the team name
     AAA) and, because the caller is a manager, they land on the "Subordinates" card grid pinned
     to that team.
3. They look at a subordinate's card (AAA Three).
   - *Expected*: the same person cards as My subordinates — the stats block (e.g. "Last 1:1") is
     present, and the card's 1:1 actions menu offers "New 1:1 with AAA Three".
4. They open the Goals drill-down for AAA Three.
   - *Expected*: the per-user goals page opens.
5. They use the "Back to Team subordinates" link.
   - *Expected*: they return to the team-details subordinates grid — the drill-down carries the
     team origin, so the back link has full fidelity.
6. They use the tab's own "Back to My teams" anchor.
   - *Expected*: they are back on the Dashboard's My teams tab.

## Scenario: a non-manager sees the My teams empty state

1. AAA One (who manages no team) signs in and opens the Dashboard's "My teams" tab.
   - *Expected*: the "No managed teams" empty state is shown.
