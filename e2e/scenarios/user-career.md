# Career progression — the chain manager's timeline and the Career page

- **Spec**: [tests/user-career.spec.ts](../tests/user-career.spec.ts)
- **Actors**: the seed Administrator (mints throwaways, edits the dictionary), a throwaway manager
  "E2E Career Mgr" and a throwaway subordinate "E2E Career Sub" on a throwaway team (passwords
  from the one-time reveal modal)
- **Owns** (exclusive server-side state): the `career-paths` dictionary (this file is its only e2e
  writer, per the Parallel-execution rulebook — one appended-then-retired throwaway entry per
  run, the same shared-dictionary etiquette the retired user-edit career leg used), plus the
  throwaway users + team it mints
- **Since**: v2.15.0 (manager-managed position timeline; the admin form lost its career fields),
  v2.15.1 (all three fields required; the form prefills from the current position),
  v2.15.2 (a date-only repeat of the current position stays disabled), v2.16.0 (the nav Career
  page: My career + Team pyramid), v2.17.0 (the pyramid's time slider)

## Scenario: career progression: chain manager records positions, the person sees the timeline

1. The admin signs in and mints the run's cast: a throwaway manager, a throwaway subordinate, and
   a throwaway team where the manager manages the subordinate.
2. The admin appends a throwaway entry (unique English value + a Polish translation —
   optional since v2.20.0, filled here) to the
   **career-paths** dictionary and saves — the shared-dictionary append idiom.
3. The admin opens the subordinate's user edit form.
   - *Expected*: the form has **no** career fields anymore (v2.15.0) — no Career path picker;
     career data is not an admin write.
4. The admin signs out; the manager signs in and drills into the subordinate's career from the
   dashboard's subordinates card ("Career progression of …").
   - *Expected*: the career progression screen opens with "No positions recorded yet."
5. The manager starts the first position: start date 2024-01-01, the throwaway career-path entry
   (searched for in the picker — the shared dictionary's list is long), plus the first available
   specialization and seniority (all three fields are required since v2.15.1; these two seed
   values are stable-id picks with nothing asserted on them).
   - *Expected*: the position appears marked **Current**, showing the career-path value.
6. They start a second position dated 2025-02-01 — the form prefills from the current position
   (v2.15.1), and with only the date changed the submit stays disabled with a note that this
   repeats the current position exactly (v2.15.2: the triple must differ). Changing the seniority
   to a different value enables the submit, and they start the position.
   - *Expected*: exactly one position is Current now; both positions (started 2024-01-01 and
     2025-02-01) sit on the timeline — starting the second concluded the first.
7. They correct the historical position's start date in place (2024-01-01 → 2024-03-01) and save.
   - *Expected*: the timeline shows the corrected start date.
8. They delete the newer position (confirmed).
   - *Expected*: one position remains, and the survivor reopens as **Current**.
9. They open the subordinate's user-details view.
   - *Expected*: the current position's career-path value backs the Profile section.
10. Still as the manager, they open the nav **Career** page (v2.16.0).
    - *Expected*: the **My career** tab shows their own (empty) timeline — "No positions recorded
      yet."
11. They switch to the **Team pyramid** tab.
    - *Expected*: exactly one row for the subordinate, carrying the surviving position's value.
12. Via the filters they widen **Reports** to "All reports (including indirect)".
    - *Expected*: the pyramid re-fetches with the wider scope; the subordinate's row is still the
      one row.
13. They nudge the time slider one day back (v2.17.0), then click **Today**.
    - *Expected*: the "As of …" badge appears for the past date and disappears on Today. (The
      slider is always usable here: this spec's own position guarantees an earliest start before
      today.)
14. They flip the pyramid to the **Chart** view.
    - *Expected*: the distribution chart replaces the table.
15. The manager signs out; the subordinate signs in and opens the notification bell.
    - *Expected*: a notification that a new position was recorded in their career progression.
16. The subordinate opens their own career timeline.
    - *Expected*: read-only — the Current position shows, but there is no "Start a new position"
      editor. On the nav Career page they get **My career only** — no Team pyramid tab, even when
      the pyramid tab is requested directly by URL.
17. The subordinate signs out; the admin signs back in and **renames** the throwaway
    career-paths entry in the dictionary editor.
    - *Expected*: the rename propagates through the position's entry reference — the subordinate's
      details Profile now shows the renamed value.
18. The admin **removes** the throwaway entry from the dictionary and saves (the cleanup half of
    the append idiom).
    - *Expected*: the retired entry keeps resolving on the subordinate's timeline — positions
      store the entry by id, so history survives dictionary retirement (the old user-edit
      acceptance scenario, re-homed here).

## Not covered here (and why)

- The time slider's as-of ROW semantics (who drops from the pyramid at which past date) are
  pinned by unit and server tests; this journey asserts only the visible As-of badge round-trip.
- The specialization/seniority picks assert nothing on their values by design: they use stable-id
  seed entries so a concurrent rename by `dictionaries.spec` (which only ever appends/removes its
  own throwaway seniority entries) is harmless.
