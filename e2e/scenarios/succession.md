# Succession plans — critical seats, nominated successors, linked development goals

- **Spec**: [tests/succession.spec.ts](../tests/succession.spec.ts)
- **Actors**: Manager AAA (the plan owner), AAA One (the seat's person — the feature's
  invisible subject), AAA Two and AAA Three (the nominated candidates)
- **Owns** (exclusive server-side state): Manager AAA's succession plans (seat: AAA One,
  candidates: AAA Two and AAA Three) plus the development goal the nomination modal creates
  for the (Manager AAA, AAA Two) pair — goals.spec owns the (Manager AAA, AAA Three) *goal*
  pair, and no goal is created for AAA Three here, so no collision; everything is
  unique-texted and deleted in-test, with an API fallback in `afterEach`, so a failed run
  leaves no residue; seeded accounts are never mutated
- **Since**: v2.42.0 (the feature's introduction); the one-primary confirm-demote step joined
  in v2.43.0

## Scenario: a manager plans a succession, nominates a successor with a linked development goal, and closes the plan

1. Manager AAA signs in, opens "Succession plans" from the left menu (the leaf is
   manager-only), and clicks "New plan".
   - *Expected*: the "New succession plan" screen opens with the owner shown as plain "You"
     and a person picker over the manager's reporting line.
2. They pick AAA One as the seat's person, set Role criticality to **Critical** and Retention
   risk to **High**, add one loss-impact item (a unique text), keep the default target bench
   depth of 2, and click **Create**.
   - *Expected*: a "Succession plan created" toast; the screen lands on the new plan's view —
     the Critical/High badges show, the loss-impact item lists, and the orange under-bench
     cue reads "The bench is below target: 0 of 2 successors nominated.".
3. They click **Add nomination**, pick AAA Two as the candidate (any active user except the
   seat's person qualifies), set the readiness window to "Ready now (0–3 mo)", and add one
   competency gap (a unique text).
   - *Expected*: because AAA Two is in the manager's own chain, the **New development goal**
     button is offered under the Development action items picker.
4. They click **New development goal**, fill the modal (a unique title, target 3, a future
   due date), and Create it.
   - *Expected*: a "Development goal created and linked" toast; the fresh goal appears
     pre-selected in the Development action items picker as "<title> (Draft)" — linked by
     default, with no navigation away from the half-filled nomination form.
5. They submit the nomination with **Create**.
   - *Expected*: a "Nomination added" toast; back on the plan view the nomination card shows
     AAA Two, the readiness window, the competency gap, and the linked goal as a chip; the
     under-bench cue now reads "1 of 2".
6. They click **Add nomination** again, pick AAA Three as the candidate, and switch the
   nomination type — pre-set to **Secondary**, since the plan already holds a primary — to
   **Primary**, then submit with **Create**.
   - *Expected*: a confirmation dialog explains that AAA Two is currently the primary
     successor and that making AAA Three primary will change AAA Two's nomination to
     secondary; continuing via **Make primary** yields the "Nomination added" toast, the plan
     view shows AAA Three as the only Primary with AAA Two now Secondary (the demotion rode
     the same write), and the 2-of-2 bench retires the under-target cue.
7. Manager AAA signs out; AAA One (the seat's person) signs in.
   - *Expected*: no "Succession plans" leaf in their navigation (they manage nobody), and a
     direct visit to `/succession` shows only an empty "My plans" list — the feature is
     invisible to its subjects.
8. AAA One signs out; Manager AAA signs back in, opens the plan, clicks **Close plan**, and
   confirms.
   - *Expected*: a "Succession plan closed" toast; the closed note shows, the
     Edit/Add-nomination affordances are gone, and the bench (the gap text included) stays
     browsable.
9. They click **Delete** and confirm.
   - *Expected*: a "Succession plan deleted" toast and a return to the Succession plans list.
