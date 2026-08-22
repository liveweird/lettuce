# Goals — the full DRAFT ↔ ACTIVE ↔ ARCHIVED journey

- **Spec**: [tests/goals.spec.ts](../tests/goals.spec.ts)
- **Actors**: Manager AAA (goal author), AAA Three (the subordinate — the least-used seeded pair),
  Manager CCC (a chain manager above Manager AAA — the Reports-widening and skip-level-create
  scenarios)
- **Owns** (exclusive server-side state): the goal rows it creates for the (Manager AAA, AAA Three)
  and (Manager CCC, AAA Three) pairs — unique-titled, and every scenario deletes its goal before
  ending (delete is DRAFT-only, so cleanup returns the goal to draft first when needed); seeded
  accounts are never mutated
- **Since**: v2.8.0 (the Update screen, progress comments, the return-to-draft confirmation),
  v2.9.0 (PLAN goals with milestones), v2.33.0 (the chain rule — skip-level creation)

## Scenario: a manager walks a goal around the whole lifecycle: draft, activate, progress, archive, reopen

1. Manager AAA signs in and opens AAA Three's goals drill-down from the dashboard's subordinates
   card ("Goals for AAA Three") — the same path a real manager takes.
2. They create a new goal ("New goal") with a unique title, a Target of 5, and today as the due
   date (the earliest valid due date, so the run never races midnight), then answer the
   "Do you want to activate the goal immediately?" prompt with **No**.
   - *Expected*: back on the drill-down list, the goal's row shows **Draft**.
3. From the draft row they open the editor ("Edit") and click **Save & activate** — the validated
   one-step submit.
   - *Expected*: the row now shows **Active**.
4. The active row's **Update** action opens the Update screen; the manager records a Current value
   of 3 with the comment "Three of five shipped" and saves.
   - *Expected*: back on the list, the row's current value reads 3.
5. From the row's **Lifecycle** menu they pick **Archive goal**; the archive dialog requires a
   Summary — they fill one in and confirm.
   - *Expected*: the row shows **Archived**.
6. They open the archived goal's view screen.
   - *Expected*: the record survives — the archive summary is visible, and the **History** tab
     carries the earlier progress-update comment.
7. They click **Reopen** on the view screen (the lifecycle actions sit in the footer, outside the
   tabs).
   - *Expected*: they land back on the Goals page — the goal is active again.
8. Cleanup: they return the goal to draft (confirming the "Return this goal to draft?" dialog) and
   delete it from the draft editor (confirming "Delete this draft goal?").
   - *Expected*: back on the drill-down list, the goal is gone.

## Scenario: a PLAN goal: milestones defined in draft, ticked on the update screen, struck through when done

1. Manager AAA signs in, opens AAA Three's goals drill-down, and starts a new goal with a unique
   title, picking the **Plan (milestones)** type.
   - *Expected*: the Target field disappears — a PLAN goal has no numeric target.
2. They add two milestones ("Pass the exam", "File the certificate") and today's due date, create
   the goal, and answer the activate prompt with **Yes**.
   - *Expected*: back on the list, the row's current-value cell is the milestone tally **0 / 2**.
3. The row's **Update** action opens the Update screen; they tick "Pass the exam" and add the
   comment "Exam passed on the first try", then save.
   - *Expected*: back on the list, the tally reads **1 / 2**.
4. They open the goal's view screen.
   - *Expected*: the done milestone is visibly settled (struck through), the open one is not, the
     tally reads "1 of 2 done", and the **History** tab shows the tick event
     ("Milestone 1 marked as done.") together with its comment.
5. Cleanup: return to draft, delete from the draft editor.

## Scenario: the Goals-I've-set tab: Reports widens from own goals to goals set down the chain

1. Manager AAA signs in and activates a goal for AAA Three (create, then **Yes** at the activate
   prompt) — from Manager CCC's viewpoint this is a chain goal, since Manager AAA is a member of
   team CCC, which Manager CCC manages.
2. Manager AAA signs out; Manager CCC signs in and opens the Goals page's **Goals I've set** tab,
   then filters by the goal's unique title (the shared database may hold other goals, so the walk
   is filter-anchored).
   - *Expected*: with the default direct-reports scope the chain goal does **not** appear — direct
     scope must not leak it.
3. They widen the **Reports** scope to "All reports (including indirect)".
   - *Expected*: Manager AAA's goal appears with status **Active**, and it is strictly read-only
     for a chain manager who is no party to it — a **View** action only: no Edit, no Update, no
     Lifecycle menu.
4. Cleanup: Manager CCC signs out; Manager AAA (the goal's own manager) signs back in, returns the
   goal to draft, and deletes it.

## Scenario: a chain manager creates a goal for a skip-level report via the widened picker

1. Manager CCC signs in and opens the goal create screen without a preselected person, so the
   **Team member** picker renders.
2. They pick **AAA Three** — an INDIRECT report (AAA Three is on team AAA, whose manager sits on
   team CCC); since v2.33.0 (the chain rule) the picker pool spans the caller's whole transitive
   subtree, not just direct reports.
3. They fill the definition (unique title, target, today's due date) and **Create**, answering
   **No** at the activate prompt — the goal stays a DRAFT.
4. They open the Goals page's **Goals I've set** tab and filter by the unique title.
   - *Expected*: the draft appears at the DIRECT scope — the creator IS the goal's stored
     manager, so no Reports widening is needed to see one's own authored goal.
5. Cleanup: still as Manager CCC (the author), they delete the draft from its editor.

## Scenario: activating at creation notifies the subordinate, who updates progress with a comment that notifies the manager

1. Manager AAA signs in and creates a goal for AAA Three, answering the activate prompt with
   **Yes**.
   - *Expected*: the row shows **Active** immediately.
2. Manager AAA signs out; AAA Three signs in and opens the notification bell.
   - *Expected*: a notification says Manager AAA activated the goal (named by its title) for them.
3. AAA Three opens their **My goals** list.
   - *Expected*: the goal is there as Active, with **no** Lifecycle menu — the subordinate updates
     progress but never drives the lifecycle.
4. They open the goal's **Update** screen and save a comment-only update ("No movement yet —
   kickoff next week") without touching the value — the context lands in the history while the
   value stays put.
5. AAA Three signs out; Manager AAA signs in and opens the bell.
   - *Expected*: the counterparty notification says AAA Three updated the goal's progress, and the
     goal's **History** tab carries the comment.
6. Cleanup: the manager returns the goal to draft and deletes it.

## Not covered here (and why)

- The goal authorization/visibility matrix (who may read a DRAFT, chain-manager rules per status)
  is exhaustively covered by the server's `AuthorizationTest`; this journey asserts only its
  user-visible consequences (the read-only chain row, the absent lifecycle affordances).
