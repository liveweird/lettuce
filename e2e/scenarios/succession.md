# Succession plans — critical seats, nominated successors, linked development goals

- **Spec**: [tests/succession.spec.ts](../tests/succession.spec.ts)
- **Actors**: Manager AAA (the plan owner), AAA One (the seat's person — the feature's
  invisible subject), AAA Two and AAA Three (the nominated candidates)
- **Owns** (exclusive server-side state): Manager AAA's succession plans (seat: AAA One,
  candidates: AAA Two and AAA Three) plus the development goal the nomination modal creates
  for the (Manager AAA, AAA Two) pair — goals.spec owns the (Manager AAA, AAA Three) *goal*
  pair, and no goal is created for AAA Three here, so no collision; everything is
  unique-texted and deleted in-test, with an API fallback in `afterEach`, so a failed run
  leaves no residue — and a `beforeEach` API sweep deletes any stranded plan for the owned
  pair (a prior failed run or manual testing on the shared volume would otherwise 409 the
  create and block the spec permanently, the pulse.spec sweep precedent); seeded accounts are
  never mutated
- **Since**: v2.42.0 (the feature's introduction); the one-primary confirm-demote step joined
  in v2.43.0; the Review-screen flow (sliders, tabs, Complete review / Close warning,
  list-only Delete) in v2.44.0

## Scenario: a manager plans a succession, nominates a successor with a linked development goal, and closes the plan

1. Manager AAA signs in, opens "Succession plans" from the left menu (the leaf is
   manager-only), and clicks "New plan".
   - *Expected*: the "New succession plan" screen opens with the owner shown as plain "You",
     a person picker over the manager's reporting line, and the Role-criticality /
     Retention-risk **sliders** resting mid-scale (Core / Medium).
2. They pick AAA One as the seat's person, promote both sliders one step to the severe end
   (**Critical** / **High**, by keyboard), add one loss-impact item (a unique text), keep the
   default target bench depth of 2, and click **Create**.
   - *Expected*: a "Succession plan created" toast; the screen lands on the plan's **Review
     screen** (Basic-info tab) — the definition is inline-editable (the loss-impact row holds
     its text) and the orange under-bench cue reads "The bench is below target: 0 of 2
     successors nominated.".
3. On the **Nominations tab** they click **Add nomination**, pick AAA Two as the candidate,
   set the readiness window to "Ready now (0–3 mo)", and add one competency gap (a unique
   text); because AAA Two is in the manager's own chain, the **New development goal** button
   is offered — they fill its modal (a unique title, target 3, a future due date) and Create
   it, then submit the nomination with **Create**.
   - *Expected*: a "Development goal created and linked" toast with the fresh goal
     pre-selected as "<title> (Draft)" (linked by default, no navigation away), then a
     "Nomination added" toast; back on the Review screen the Basic-info cue reads "1 of 2"
     and the Nominations tab shows the card — AAA Two, the readiness window, the gap, and the
     linked goal as a chip.
4. They edit AAA Two's nomination and tick the competency gap's **filled** checkbox (the
   v2.45.0 progress flag next to each gap), then Save.
   - *Expected*: a "Nomination updated" toast; back on the Nominations tab the filled gap
     renders **struck through** (and dimmed) on the read-only card — unfilled gaps stay plain.
5. They add a second nomination for AAA Three: the nomination type is pre-set to
   **Secondary** (the plan already holds a primary); they switch it to **Primary** and
   submit.
   - *Expected*: a confirmation dialog explains that AAA Two is currently the primary
     successor and continuing via **Make primary** demotes them; after continuing, the
     "Nomination added" toast shows, the Nominations tab lists AAA Three as the only Primary
     with AAA Two now Secondary, and the 2-of-2 bench retires the under-target cue.
6. They click **Complete review**.
   - *Expected*: a "Review completed" toast (the plan's last-reviewed date is stamped — the
     ONLY thing that updates it besides creation) and a return to the Succession plans list,
     where the row shows the filled Critical/High badges and a **Review** action (there is no
     Edit action anymore).
7. They re-enter the plan via **Review** and leave via **Close**.
   - *Expected*: a warning dialog says closing the screen will not count as a review of the
     plan; confirming with **Leave** returns to the list without touching the plan.
8. Manager AAA signs out; AAA One (the seat's person) signs in.
   - *Expected*: no "Succession plans" leaf in their navigation (they manage nobody), and a
     direct visit to `/succession` shows only an empty "My plans" list — the feature is
     invisible to its subjects.
9. AAA One signs out; Manager AAA signs back in, opens the plan, clicks **Close plan**, and
   confirms.
   - *Expected*: a "Succession plan closed" toast; the closed note shows, the Complete-review
     and Add-nomination affordances are gone, and the bench (the gap text included) stays
     browsable on the Nominations tab.
10. They close the read-only screen and delete the plan **from the list row**, confirming the
   dialog.
   - *Expected*: a "Succession plan deleted" toast on the Succession plans list — the Review
     screen itself no longer offers Delete.
