# Pulse surveys — full cycle lifecycle

- **Spec**: [tests/pulse.spec.ts](../tests/pulse.spec.ts)
- **Actors**: the seed admin (cycle lifecycle), AAA One (the UI participant/respondent),
  AAA Two + AAA Three + Manager CCC (API respondents, setup only), Manager AAA (the
  non-responding monitor), Manager CCC (the two-view Results + Trend session)
- **Owns** (exclusive server-side state): the global pulse-cycle registry (the
  one-non-terminal-cycle invariant) and, transitively, every user's bell — opening a cycle
  sprays notifications org-wide. The spec therefore runs in its **own serial `pulse` project
  phase**, chained after `alerts` (chromium → alerts → pulse); no other spec runs concurrently.
  Each run accretes one CLOSED (plus one CANCELLED) cycle on the shared database, so results
  asserts always pin the CURRENT cycle (via the notification deep link / latest-closed
  default), never cycle #1.
- **Since**: v2.0.0 (pulse surveys), v2.5.9 (the one-question-per-step wizard + saved summary),
  v2.6.2 (hand-computed aggregates), v2.12.0 (two-view Results layout), v2.14.0 (Trend team
  pills)

The tests are ordered steps of one flow — schedule → open → fill → monitor → close → results →
cancel path. The registry is swept at the start and left terminal at the end.

## Scenario: admin schedules a cycle (prefilled dates) and opens it

**Precondition**: any stranded scheduled or open cycle from a failed earlier run is cancelled
first via the admin API — the registry admits only one non-terminal cycle, so residue would
block this run's schedule.

1. The admin opens the Pulse cycles config page.
   - *Expected*: the settings section ("Weeks between cycles") is visible — the runtime
     settings store round-trips (values whatever they are).
2. The admin waits for the Open date to prefill (latest cycle + cadence; today on a fresh
   database) and clicks "Schedule cycle".
   - *Expected*: "Cycle scheduled", and the cycle is listed as Scheduled.
3. The admin opens the cycle via its "Open cycle" action, confirming with "Open now".
   - *Expected*: "Cycle opened"; the cycle shows as Open.

## Scenario: a participant is notified, walks the wizard, and edits it while open

1. AAA One signs in and opens the bell.
   - *Expected*: a "The pulse survey is open" notification (the newest one — the text repeats
     across reruns on the shared database).
2. AAA One opens the Pulse page. The wizard shows one question per step and never
   auto-advances — every answer needs an explicit Next.
   - *Expected*: "Question 1 of 7" and "0 of 6 answered".
3. AAA One picks eNPS score 9, clicks Next, then answers questions 2–6 with "Agree" (Next
   after each).
   - *Expected*: the step counter advances through "Question N of 7" each time.
4. On the final step, AAA One submits the survey.
   - *Expected*: "Question 7 of 7" and "6 of 6 answered"; because eNPS 9 is promoter-band, the
     comment prompt reads "What should we make sure to preserve?"; "Survey submitted", then the
     saved-summary screen ("Your answers are saved").
5. "Edit my answers" reopens the wizard at question 1, prefilled; AAA One changes eNPS to 10,
   steps through to the end, and clicks "Save changes".
   - *Expected*: "Survey submitted" again, and back on the saved summary.

## Scenario: the manager monitors participation live while the cycle is open

**Setup**: a second respondent (AAA Two, eNPS 8) submits via the API — the same endpoint the
SPA uses; AAA Three deliberately stays pending.

1. Manager AAA opens the Pulse page's Participation tab.
   - *Expected*: per-person submitted status only — never content: AAA One "Submitted",
     AAA Two "Submitted", AAA Three "Not yet".

## Scenario: admin closes; a respondent reads team results; the non-responding manager still reads comments

**Setup**: two more responses arrive via the API to reach the k≥3 anonymity threshold —
AAA Three (eNPS 2) with this run's unique comment, and Manager CCC (eNPS 8). Manager CCC is a
member of no team, so no scope's hand-computed numbers move; their response only passes the
fill gate for the "Teams I manage" leg below.

1. The admin closes the cycle ("Close cycle" → "Close now").
   - *Expected*: "Cycle closed".
2. AAA One (a respondent) finds the results notification in the bell — deep-linked to THIS
   cycle — and opens the Results tab.
   - *Expected*: "Pulse survey results are available."; the AAA team card shows
     "3 of 3 responded (100%)" and an eNPS section.
3. The aggregates are checked against hand-computed values for this cycle's known answers
   (why: this verifies the whole submit → encrypt → store → decrypt → aggregate → render pipe,
   not just labels). eNPS {10, 8, 2} = 1 promoter / 1 passive / 1 detractor.
   - *Expected*: eNPS headline 0 with Promoters, Passives, and Detractors at 33.3% each; the
     "I understand what is expected" row shows mean 4.0 and 100.0% favorable; the "I receive
     the support" row shows mean 3.3 and 33.3% favorable; the "My current workload" row shows
     mean 4.0 with n = 1 (the two "not applicable" answers shrink n but leave the mean).
4. As a plain team member, AAA One gets no comments section.
   - *Expected*: the run's unique comment is nowhere on the page.
5. Manager AAA — who never filled their own survey — opens Results.
   - *Expected*: the aggregates stay gated ("Results are available for closed cycles you took
     part in.") but the monitoring right still surfaces the anonymized comments: the run's
     comment is visible, marked "Shown anonymized and in random order."
6. Manager CCC (a respondent who belongs to NO team) opens Results — the two-view layout. The
   default "Teams I belong to" view is the member empty state.
   - *Expected*: "You are not a member of any team.", and no comments.
7. Switching to "Teams I manage" lists cards for CCC, AAA, and BBB on the direct calculation.
   - *Expected*: CCC is withheld with only the count visible — "0 of 2 responded (0%)" plus
     "Fewer than 3 responses — results are hidden to protect anonymity."; AAA shows
     "3 of 3 responded (100%)"; BBB is withheld too; the run's comment renders here
     (monitoring is a standing right), sitting in AAA's scope.
8. Switching the calculation to "Including everyone below" widens CCC to its whole subtree.
   - *Expected*: CCC reads "3 of N responded" with eNPS 0 — N is deliberately unpinned, because
     the performance-reviews spec creates a Manager-AAA-managed team every run that joins CCC's
     subtree on the shared database (the response count stays 3; the participant total
     accretes); AAA stays "3 of 3 responded (100%)".
9. The same session opens the Trend tab: the member view first, then "Teams I manage".
   - *Expected*: the member empty state ("You are not a member of any team."); then one pill
     per monitored team — AAA, BBB, and CCC, all on (one line each).
10. The trend outcome is asserted chart-or-pending either-or, through the calculation switch to
    "Including everyone below" and the metric switch to Q2 (why: chart presence is
    run-dependent — CI has exactly one closed cycle, so "The trend appears after two closed
    cycles." shows; shared-database reruns accumulate cycles and the chart renders).
    - *Expected*: after each switch, either the chart or the pending text is visible; picking
      Q2 shows its full caption, "I understand what is expected of me in my role."

## Scenario: cancelling a scheduled cycle is confirmed and leaves the registry terminal

1. The admin schedules another cycle with the prefilled dates.
   - *Expected*: "Cycle scheduled".
2. The admin cancels it via its "Cancel cycle" action.
   - *Expected*: the confirmation is audit-honest — "Submitted answers are kept for audit";
     after confirming, "Cycle cancelled" and the cycle is listed as Cancelled, so the registry
     ends the run terminal.

## Not covered here (and why)

- **Cycle-over-cycle deltas** on the results card — a shared-database rerun has a previous
  cycle while CI does not, so delta values are run-dependent.
- **Trend chart point counts or values** — the same run-dependence; every trend assert is a
  chart-or-pending either-or.
- **The subtree participant total** ("3 of N") — the performance-reviews spec accretes one
  team into CCC's subtree per run, so only the response count (3) is pinned.
