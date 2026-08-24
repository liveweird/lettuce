# Org chart canvas

- **Spec**: [tests/org-chart.spec.ts](../tests/org-chart.spec.ts)
- **Actors**: AAA One (seed regular user); seed people and teams viewed — teams AAA and CCC,
  Manager AAA, Manager CCC, the Administrator
- **Owns** (exclusive server-side state): nothing — read-only; no data is created or mutated
- **Since**: v1.23.0 (the org chart), v1.30.2 (teamless people render as ordinary clickable
  nodes under "Not in any team"), v2.40.0 (left→right orientation; team nodes collapse/expand
  their members — client-side only)

The whole organization as a canvas: person nodes open the user-details view, team nodes open the
roster, with manages/member edges between them. Assertions target only seeded people and teams —
they always exist, whatever else e2e runs have added to the shared database.

## Scenario: the org chart renders the seed org and drills into details and rosters

1. AAA One signs in and opens **Config → Org chart**.
   - *Expected*: the org-chart page opens.
2. AAA One surveys the canvas.
   - *Expected*: the seed org renders — the CCC and AAA team nodes and Manager CCC's person node
     (the manager chain: CCC's manager above the members who themselves manage AAA/BBB); the
     viewer's **own** node is plain — no details affordance for oneself.
3. AAA One looks below the teams.
   - *Expected*: people in no team (the seed Administrator) render under the "Not in any team"
     section as ordinary clickable nodes.
4. AAA One collapses the CCC team node (its chevron toggle).
   - *Expected*: CCC's members fold away — Manager AAA's node disappears, and so does the AAA
     team they manage (the collapse cascades through a hidden member's own subtree); the CCC
     node itself and Manager CCC stay visible.
5. AAA One expands the CCC team node again.
   - *Expected*: the folded subtree is restored — Manager AAA's node and the AAA team are back.
6. AAA One clicks Manager AAA's person node.
   - *Expected*: the user-details view opens with the manager-flavor card ("One of your
     managers").
7. AAA One uses the "Back to Org chart" link.
   - *Expected*: back on the chart — the details view carried the org-chart origin.
8. AAA One clicks the AAA team node.
   - *Expected*: team AAA's roster opens (the Team details page); its back link also reads
     "Back to Org chart" — returning to the chart, not the teams list.
9. AAA One uses that back link.
   - *Expected*: back on the chart.
