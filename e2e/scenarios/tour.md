# Guided tour — the two audience walks

- **Spec**: [tests/tour.spec.ts](../tests/tour.spec.ts)
- **Actors**: Manager AAA (a manager who is not an admin), Administrator (an admin who manages
  no team) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only (the suite's tour-seen stub only
  suppresses the tour's auto-start; the replay button always works, and walking the tour mutates
  no server state)

## Scenario: the guided tour walks all 22 manager menu steps in the documented order

1. Manager AAA signs in; the alert banner is collapsed first (a pre-existing active alert's
   expanded banner would overlay the header, replay button included).
2. They start the tour via "Replay this tour" and click "Next" through every step until "Done".
   - *Expected*: exactly 22 steps — since v3.23.0 the tour is a menu presentation only: the
     welcome step, one stop per left-nav leaf/group in navbar order (Dashboard, Kudos, Feedback,
     1:1 meetings, Goals, Impact log, Career, Days off, Team KPIs, Performance, Pulse, Succession
     plans, Config, Dictionaries, Change password, Changelog), then the four header icons
     (Notifications, language switch, theme toggle, account menu) and the closing help/replay
     step. Manager AAA is a manager, so the manager-only Succession stop is present.
   - *Expected*: the documented landmarks appear each exactly in order, strictly one after
     another. No step opens or navigates to any page — every stop spotlights a chrome element
     only. Anchors or steps that vanish or reorder fail the walk.
3. The tour finishes.
   - *Expected*: the walk never left the Dashboard — the URL after the walk is unchanged from
     before it started.

## Scenario: the guided tour walks the 21 admin menu steps without the manager-only Succession stop

1. The administrator signs in; the alert banner is collapsed first.
2. Before walking, the expected step count is derived from whether the admin currently manages
   any team — the same signal the app's own manager gate uses. Why: the shared dev database may
   carry a manually created team managed by the admin, which would legitimately add the one
   manager-gated step (Succession plans) on top of the baseline 21.
3. They start the tour via "Replay this tour" and click "Next" through every step until "Done".
   - *Expected*: 21 steps for the pristine seed admin (an ADMIN who manages no team — the
     Succession stop drops out), or 22 when the dev database gives them a managed team.
   - *Expected*: the admin landmark order holds — the same menu-only walk as the manager,
     minus the "Succession plans —" landmark.
4. The tour finishes.
   - *Expected*: the walk never left the Dashboard — the URL after the walk is unchanged from
     before it started.
