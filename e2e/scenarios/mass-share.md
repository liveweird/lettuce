# Mass sharing of performance reviews — pick, share in one go, read read-only, withdraw one

- **Spec**: [tests/mass-share.spec.ts](../tests/mass-share.spec.ts)
- **Actors**: Administrator (creates the throwaways), four throwaway users — a manager M, two
  reports R1 and R2, and a bystander sharee X
- **Owns** (exclusive server-side state): the four throwaway users, one throwaway team (manager M,
  members R1 and R2), M's two DRAFT performance reviews of R1 and R2 for the current review
  period, and the two shares of them to X. Nothing else in the suite touches any of them; the
  residue sweep removes the users and the team. The review-period timeline is a global registry
  owned by `performance-reviews.spec`: this spec only reads it, and writes (one period starting
  this month, as ADMIN over the API) solely when the timeline is completely empty — the same
  one-off fresh-database precondition `performance-reviews-tutorial.spec` applies.
- **Since**: v4.10.0

## Scenario: a manager shares two team reviews in one go, the sharee reads them read-only, and one share is withdrawn

1. The administrator creates the four throwaway users through the Users form (the one-time
   password reveal supplies each credential) and signs out. The throwaway team (manager M,
   members R1 and R2) and M's two DRAFT reviews for the current period are then created over the
   API — setup only; the journey under test starts at the Team's-performance page.
2. M signs in, opens Performance → "Team's performance", selects the current period and follows
   the "Share reviews…" link.
   - *Expected*: the address is the mass-share page for that period, headed "Share performance
     reviews".
3. M sees R1 and R2 listed with enabled "Select <name>" checkboxes, opens the filters, narrows the
   "Teams" filter to the throwaway team and presses "Select all matching (2)".
   - *Expected*: both checkboxes are checked.
4. M presses "Share 2 reviews…", picks X in the "Share with" recipients picker, enters an end date
   30 days ahead in "Until" and submits.
   - *Expected*: the "Reviews shared" toast appears and the dialog's result reads "New shares: 2".
     M closes the dialog and signs out.
5. X signs in and opens the notification bell.
   - *Expected*: ONE summary card "<M> shared 2 performance reviews with you." is there — exactly
     one card from M, and no per-review "shared a performance review with you" card; following
     its "Go to" action opens the Shared screen.
   - *Expected*: the Shared screen lists two rows, "<R1>, <period>" and "<R2>, <period>", both
     status Active, naming M as the sharer.
6. X opens R1's row.
   - *Expected*: the review page says "Shared with you by <M>" and offers X no "Share" button,
     no "Edit" link and no lifecycle button (Submit for calibration, Return to draft, Publish,
     Unpublish) — only "Close" (X holds the review through the share alone). X signs out.
7. M signs in, opens R1's review, presses "Share", chooses "Withdraw the share with <X>" and
   confirms.
   - *Expected*: the "Share withdrawn" toast appears and X's row in the dialog's current shares
     reads Withdrawn. M closes the dialog and signs out.
8. X signs in again, opens the Shared screen and filters by status Active.
   - *Expected*: R2's row is listed and R1's row is gone.

## Not covered here (and why)

- Greyed-out people (no review in the period, another manager's draft), the other facet filters,
  paging, the 100-review chunking, the "recipient is also a reviewed person" warning, and the
  partial-failure/retry panel — covered by the server's `ShareBatchRoutesTest` /
  `ShareCandidatesTest` and the SPA's `massShare` unit and `MassSharePerformanceReviews`/`MassShareDialog`
  vitest cases; one browser journey proves the wiring end to end.
- Every other document kind — mass sharing exists for performance reviews only.
