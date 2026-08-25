# Guided tour — the two audience walks

- **Spec**: [tests/tour.spec.ts](../tests/tour.spec.ts)
- **Actors**: Manager AAA (a manager who is not an admin), Administrator (an admin who manages
  no team) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only (the suite's tour-seen stub only
  suppresses the tour's auto-start; the replay button always works, and walking the tour mutates
  no server state)

## Scenario: the guided tour walks all 54 manager steps in the documented order

1. Manager AAA signs in; the alert banner is collapsed first (a pre-existing active alert's
   expanded banner would overlay the header, replay button included).
2. They start the tour via "Replay this tour" and click "Next" through every step until "Done".
   - *Expected*: exactly 54 steps. Audience math over the 57 total steps: Manager AAA is a
     manager but not an ADMIN, so the three admin-only Config leaves (Pulse cycles, Feature
     flags, Alerts) are absent.
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another — the whole left menu (Feedback, Kudos, 1:1 meetings, Goals, Impact log, Team
     KPIs, Performance, Career, Days off, Pulse, Succession plans, Config, Changelog included) and
     every tab of the views those sections open (My goals / Goals I've set, My performance /
     Team's performance, My career / Team pyramid, Calendar / My requests / My team, Current
     survey / Results / Trend / Participation, Review periods / Public holidays /
     Dictionaries…), before the header icons (Notifications, language switch, theme toggle,
     account menu, Replay). Anchors or steps that vanish or reorder fail the walk.
3. The tour finishes.
   - *Expected*: the closing step has returned the user home.

## Scenario: the guided tour walks the 47 admin steps including the admin-only Config leaves

1. The administrator signs in; the alert banner is collapsed first.
2. Before walking, the expected step count is derived from whether the admin currently manages
   any team — the same signal the app's own manager gate uses. Why: the shared dev database may
   carry a manually created team managed by the admin, which would legitimately add the nine
   manager-gated steps (the eight manager-only tab steps, the manager-only Succession step,
   plus the manager-or-HR Pulse participation step) on top of the baseline 47.
3. They start the tour via "Replay this tour" and click "Next" through every step until "Done".
   - *Expected*: 47 steps for the pristine seed admin (an ADMIN who manages no team — the
     manager-only tab steps drop out), or 57 when the dev database gives them a managed team.
   - *Expected*: the admin landmark order holds: the shared left-menu sections, then the three
     admin-only Config leaves — "Pulse cycles", "Feature flags", "Alerts" — joining between the
     registries (Review periods, Public holidays) and Dictionaries, then the account steps and
     "Replay this tour".
4. The tour finishes.
   - *Expected*: the closing step has returned the user home.
