# Team KPIs — lifecycle, inline data points, the members' shared data entry

- **Spec**: [tests/team-kpis.spec.ts](../tests/team-kpis.spec.ts)
- **Actors**: Manager AAA (KPI author — manages team AAA), AAA One (a team AAA member)
- **Owns** (exclusive server-side state): the KPI rows it creates on team AAA — unique-titled, and
  every scenario deletes its KPI before ending (delete is DRAFT-only, so cleanup returns the KPI
  to draft first when needed); seeded accounts are never mutated
- **Since**: v1.29.0 (the tabbed view screen as THE KPI screen), v1.29.1 (a manager's DRAFT row
  opens the editor directly), v1.30.0 (members notified about recorded data points), v2.26.0
  (recording data is the team's shared work — members add/correct/remove points; lifecycle stays
  manager-or-chain)

## Scenario: a manager walks a team KPI around the whole lifecycle, managing its data points inline

1. Manager AAA signs in and opens team AAA's KPI drill-down from the dashboard's My-teams card
   ("Team KPIs of AAA") — the same path a real manager takes.
2. They create a new KPI ("New team KPI") with a unique title and a Target of 50, then answer the
   "Do you want to activate the KPI immediately?" prompt with **No**.
   - *Expected*: back on the drill-down list, the KPI's row shows **Draft**.
3. The manager's draft row opens the definition editor directly (**Edit** — v1.29.1); they click
   **Save & activate**.
   - *Expected*: the row now shows **Active**.
4. They open the KPI's view screen and its **KPI data** tab.
   - *Expected*: "No data points yet."
5. They add a backdated point (Jul 1, 2026 → 30) and a later one (Jul 10, 2026 → 40) — every
   data-point operation persists immediately, there is no Save button on this screen.
   - *Expected*: both dated rows appear in the table.
6. They correct the first point inline (edit Jul 1's value to 35) and remove the second
   (confirming "Remove this data point?").
   - *Expected*: the corrected value 35 shows; the Jul 10 row is gone.
7. They open the **Graph** tab.
   - *Expected*: the chart of the KPI's value over time (against the dashed target line) renders.
8. Back on the drill-down list:
   - *Expected*: the **Current** column reflects the max-dated remaining point — 35 after the
     removal.
9. From the view screen they **Archive** — the dialog requires a Summary, which they fill in and
   confirm.
10. They reopen the archived KPI's view screen.
    - *Expected*: the record survives the round-trip — the archive summary is visible and the
      status reads **Archived**.
11. They click **Reopen** (back to the Team KPIs page — the KPI is active again).
12. Cleanup: return to draft, delete from the draft editor (confirming "Delete this draft KPI?").
    - *Expected*: the KPI is gone from the drill-down list.

## Scenario: activating at creation notifies the members, who record data but drive no lifecycle

1. Manager AAA signs in, opens team AAA's KPI drill-down, and creates a KPI, answering the
   activate prompt with **Yes**.
   - *Expected*: the row shows **Active** immediately.
2. On the view screen's **KPI data** tab the manager records a data point (Jul 27, 2026 → 42) —
   members are notified about recorded points too (v1.30.0).
3. The manager signs out; AAA One (a team member) signs in and opens the notification bell.
   - *Expected*: two notifications naming the KPI and the team — one for the recorded value
     ("recorded 42 for Jul 27, 2026 …") and one for the activation.
4. AAA One follows the activation notification's **Go to** link.
   - *Expected*: the KPI document opens with **no lifecycle affordances** — no Archive, no Edit —
     but the KPI data tab offers the add row (v2.26.0: data entry is the team's shared work), and
     AAA One records a point (Jul 28, 2026 → 44).
5. AAA One opens the Team KPIs nav page.
   - *Expected*: the KPI is listed under "My teams' KPIs" as Active, and the row action here is
     **View** too.
6. Cleanup: the member signs out; Manager AAA signs back in, returns the KPI to draft, and deletes
   it.
