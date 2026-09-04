# Performance reviews — period → draft → calibration → published, and all the way back

- **Spec**: [tests/performance-reviews.spec.ts](../tests/performance-reviews.spec.ts)
- **Actors**: the seed Administrator (period registry + throwaway minting), Manager AAA (the
  review's author), a throwaway subordinate "E2E Reviewee" on a throwaway team under Manager AAA
  (a fresh person per run keeps the one-review-per-(subordinate, period) slot new — the old
  fresh-period trick stopped working once the dev timeline extends past today)
- **Owns** (exclusive server-side state): the review-periods registry (this file is its only e2e
  writer, per the Parallel-execution rulebook) plus the throwaway subordinate + team it mints.
  Only the throwaway subordinate + team persist in the dev volume; a mid-run death can
  additionally strand a review, which blocks nothing — the next run reviews a fresh subordinate.
- **Since**: v1.33.1 (rating badge + wording on the view), v1.34.0 (the timeline's Current badge),
  v1.34.2 (a review may only target a STARTED period), v1.40.0 (the Distribution view),
  v1.45.0 (the Performance page's Team's-performance tab), v2.7.0 (the Quadrants view)

## Scenario: a performance review travels period → draft → calibration → published → subordinate

1. The admin signs in and opens Config → **Review periods**; the append form's preview line
   ("Will add: …") names the exact adjacent range **Add period** will create — the spec reads the
   label from it rather than computing months. They append the period.
   - *Expected*: the new period lands in the timeline list. Because the dev timeline extends past
     today, this fresh period is **future** — no review can target it (v1.34.2), so the journey
     instead reads the **current** period's label off the timeline's table row carrying the
     "Current" pill (the Period cell beside it). (On a brand-fresh volume the first appended period IS the current one; the admin then
     appends one more, guaranteed-future period so the disabled-option check below has a subject.)
2. The admin mints the run's throwaway subordinate ("E2E Reviewee", password from the one-time
   reveal) and a throwaway team managed by Manager AAA, adds the reviewee to it, and signs out.
3. Manager AAA signs in and opens the Performance page's **Team's performance** tab, scoping it to
   the **current** period (the default is the latest = the future one) and, via the filters, to
   the throwaway team — accumulated E2E rows would otherwise push the reviewee off page 1.
   - *Expected*: the reviewee's row reads "No review yet".
4. The manager clicks the row's **New review** action.
   - *Expected*: the create screen opens with the subordinate locked and the **current** period
     preselected (the newest **started** period is the default, never the future one); the fresh
     future period is offered in the Period picker but **greyed out/disabled** — the server would
     reject it.
5. They create the review; the editor opens directly. They rate all four categories (Attitude,
   Delivery, Skills, Overall) at "4 — Sometimes exceeds expectations" with a summary each, then
   **Save & submit**.
   - *Expected*: back on the Team's-performance tab, the reviewee's row reads **Calibration**.
6. The calibration row's action is **View** — the lifecycle lives on the view screen. The manager
   opens it and clicks **Publish**.
   - *Expected*: the view showed the rating wording; back on the tab, the row reads **Published**.
7. The manager flips the tab to the **Distribution** view (v1.40.0) — the same period + filter
   selection rendered as per-category rating-balance charts.
   - *Expected*: category tabs (Attitude … Overall) show, with "1 of 1 people rated" — also after
     switching to the Skills category.
8. They flip to the **Quadrants** view (v2.7.0) — the same selection on the 6×6 lattice.
   - *Expected*: the default axes are Delivery (X) × Attitude (Y); the reviewee (all four ratings
     4) sits at the (4, 4) cell with a details link, "1 of 1 people rated". Picking Delivery on
     the Y axis swaps the axes (they can never coincide) and re-plots instantly — the reviewee
     stays at (4, 4) on the swapped axes too.
9. Back on the **Table** view (row still Published), the manager signs out; the reviewee signs in
   with their one-time password and opens the notification bell.
   - *Expected*: a "published your performance review" notification.
10. The reviewee opens the **Performance** nav page, which lands on its default **My performance**
    tab, and views the current period's row.
    - *Expected*: the row reads Published; the view shows the rating wording and the attitude
      summary, with zero write affordances — no Unpublish, no Edit.
11. The reviewee signs out; Manager AAA signs back in, opens the review, and clicks **Unpublish**.
    - *Expected*: back on the Team's-performance tab, the row reads **Calibration** again.
12. They reopen the review and click **Return to draft**.
    - *Expected*: the row reads **Draft**.
13. From the draft row's **Edit** action they open the editor and **Delete** the draft
    (confirmed).
    - *Expected*: the reviewee's slot reads "No review yet" again — the journey ends where it
      began.

## Not covered here (and why)

- Reviewing a seeded subordinate: deliberately avoided — the one-review-per-(subordinate, period)
  slot on the long-lived shared database would collide across reruns, so each run mints a fresh
  throwaway reviewee instead.
- Creating a review for the freshly appended period: impossible by design since v1.34.2 (a review
  may only target a started period, and the fresh period is future on the grown dev timeline) —
  which is exactly why the journey targets the current period read off the timeline instead.
