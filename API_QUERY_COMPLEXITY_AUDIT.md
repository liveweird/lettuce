# API Query Complexity Audit Handoff

> **Status: static-confirmed, SQL-unmeasured.** Two independent source inspections (same day)
> agree on the shapes below. Claude Code must still **count executed SQL** (and HTTP fan-out)
> before treating anything as an implementation backlog. Do not implement solely from this note.

## Review snapshot

- Reviewed: 2026-08-17
- Branch at review time: `feat/user-language-v2.21.0`
- Review target: API handlers and services that execute database work inside collection or
  hierarchy iteration, plus SPA request fan-out that multiplies endpoint cost
- Method: static source inspection. **No** SQL statement counter, request trace, load test, or
  `EXPLAIN ANALYZE` was run
- Working-tree caveat: the tree contained unrelated uncommitted changes. Re-check anchors against
  the revision under review; line numbers drift

## How to read this

A query inside one loop is normally an **N+1 / O(N) database-round-trip problem**, not O(N²).
Quadratic-class behavior needs two growing dimensions to multiply (teams × closed cycles, carried
items × carry-over depth). Even bounded O(N) loops can still be expensive: R2DBC statements on
these paths are sequential round trips.

Each `QRY-*` item should be marked **confirmed**, **refuted**, or **changed** after measurement,
with the function `Q(N)=…`, cardinalities tested, and the git revision.

---

## Findings to verify

### QRY-001 — Pulse trend request multiplication (high)

**Static status:** independently re-read and still present.

**Observed shape**

- `pulse/PulseRoutes.kt`, `trendPoints(...)`: iterates every eligible closed cycle.
- Each included cycle calls `PulseResponseService.answersForScope(...)` and
  `participantCountForScope(...)`; each helper opens a transaction and runs a query.
- `GET /api/v1/pulse-surveys/trend` therefore looks like **~2 × C** aggregation queries for
  `C` included cycles, plus fixed scope/cycle queries.
- `web/src/pages/PulseTrend.tsx`: all team pills start ON; `useQueries` fires **one `/trend`
  per enabled team**.
- `web/src/components/PulseTeamResultCard.tsx` also calls `getPulseTrend(teamId, mode)` for
  each Results card (same query key, so Trend + Results share cache — they do **not** double
  when both tabs are warm, but Results alone still fans out per visible team).

Initial load cost appears to be **~2 × T × C** aggregation queries for `T` visible teams and
`C` included cycles. If both dimensions grow, this is **O(T × C)** (quadratic-class
cross-layer). Answer decryption also multiplies by in-scope responses per cycle.

**Constraints (do not break)**

- User-id-free answer shape and k-anonymity / fill-gate rules in
  `.claude/docs/features/pulse-surveys.md`.
- Feature docs currently treat per-cycle recomputation/decryption as an accepted small-scale
  limitation. That explains the design; it does not remove the scaling risk.

**Claude Code should verify**

1. Count SQL for one team with 1, 10, and 100 closed cycles.
2. Repeat through the SPA with 1, 10, and 100 visible teams; count `/trend` HTTP requests on
   first Trend load **and** first Results load (cold cache).
3. Check whether non-respondent cycle gaps reduce query count for ordinary users and whether
   HR remains the worst-case caller.
4. Can all cycles be loaded in two grouped queries without leaking user identity out of the
   response service?
5. After server-side batching: multi-team trend endpoint vs cycle window vs different default
   team selection.

---

### QRY-002 — Team-member latest-stat enrichments (high)

**Static status:** independently re-read and still present.

**Observed shape**

- `teams/TeamRoutes.kt`, `GET /api/v1/teams/members`, enriches the current page.
- `view=managers` → `OneOnOneService.latestMeetingStats(...)`.
- `view=managed` → `latestMeetingStatsBySubordinate(...)` **and**
  `PerformanceReviewService.latestReviewsBySubordinate(...)`.
- `OneOnOneService.latestStatsByKey(...)` (`oneonones/OneOnOneService.kt`): one indexed
  `ORDER BY … LIMIT 1` **per person**, then one grouped action-item-count query.
- `PerformanceReviewService.latestReviewsBySubordinate(...)`: same one `LIMIT 1` per
  subordinate.

Page-size maximum is 100. With 100 unique people, `view=managed` can approach **~200
latest-row selects** plus the normal list and batched enrichments. This is **O(N), not
O(N²)** — the clearest conventional N+1 hotspot.

Comments in both helpers say the set is “one page of dashboard cards — a handful” and
explicitly skip multi-group SQL.

**Claude Code should verify**

1. Statement counts for `pageSize=1`, 10, and 100 in all three views.
2. Duplicate users (same person on several teams): IDs are deduped; query count should follow
   unique people, not row count.
3. Index use on the limit-one queries (`EXPLAIN (ANALYZE, BUFFERS)`).
4. Prototype `DISTINCT ON` or `ROW_NUMBER() OVER (PARTITION BY …)`, preserving date/id
   tie-breaking and soft-delete predicates.

---

### QRY-003 — Pulse participation status per team (high)

**Static status:** independently re-read and still present.

**Observed shape**

`GET /api/v1/pulse-surveys/cycles/{id}/participation-status` (`pulse/PulseRoutes.kt`):
`teams.map` over every visible team. Per team:

1. `TeamService.membersWithNames(teamId)`
2. `PulseResponseService.participantUserIds(cycleId, memberIds)`
3. `PulseResponseService.respondedUserIds(cycleId, participantIds)`

≈ **3 × T** queries. HR can request the whole organization — **no endpoint-level page bound**.

**Claude Code should verify**

1. Query count for managers with shallow vs deep team trees, and for HR.
2. Duplicate membership: a user may appear in several team blocks (legitimate).
3. Batched prototype: memberships for all team IDs, participants for the union of member IDs,
   responses for the union of participant IDs, then group in memory.
4. Re-run authorization and pulse anonymity tests after any prototype.

---

### QRY-004 — One-on-one list latest-pair lookup (medium)

**Static status:** independently re-read and still present.

**Observed shape**

`OneOnOneService.list(...)` batches note and action-item **counts** for the page, then builds
`latestByPair` by calling `latestMeetingOfPair(...)` once per distinct manager/subordinate
pair. That flag drives the SPA’s latest-only Edit affordance.

One extra query per distinct pair, up to the 100-row page maximum. **O(N) N+1.**

**Claude Code should verify**

1. Statements for pages of repeated vs unique pairs.
2. One latest-per-pair query that stays correct when the current page does **not** contain the
   pair’s latest meeting.
3. Preserve meeting-date then ID tie-breaking, active-row filtering, authz scope, sort, paging.

---

### QRY-005 — One-on-one carried-item ancestry (medium)

**Static status:** independently re-read and still present.

**Observed shape**

On 1:1 detail, `OneOnOneService.firstAppearanceDates(...)` walks each carried item’s
`copiedFromId` chain. Every previously unseen ancestor is an indexed action-item lookup. A
row cache avoids repeats only when chains overlap.

With `I` carried items and history depth `H`, worst case is **`I × H`** ancestor queries.
`I` is capped (~100 action items per request); `H` does not appear validation-capped.
Asymptotically with the current cap this is O(H); the multiplicative shape can still be
~`100 × H` sequential queries.

**Claude Code should verify**

1. Independent carry-over chains with controlled `I` and `H`; measure SQL.
2. Can ordinary create/carry-over produce non-overlapping worst-case chains?
3. Cycle / broken-chain / soft-deleted ancestor-meeting semantics.
4. Single recursive CTE seeded by all carried item IDs, then the existing batched
   active-meeting-date resolution.

---

### QRY-006 — Org-chart client fan-out (medium, SPA not API-internal)

**Static status:** independently observed; not in the first pass’s `QRY-*` list.

**Observed shape**

`web/src/pages/OrgChart.tsx`, `fetchOrg()`:

1. `listAllTeams()` (pages `/api/v1/teams` until `total`)
2. `Promise.all(teams.map(team => getTeam(team.id)))` — **one `GET /api/v1/teams/{id}` per team**
3. `listAllUsers()` (pages `/api/v1/users`)

This is **O(T) HTTP round trips**, not O(T²). Each `getTeam` is a constant query. It still
multiplies latency with org size and is the house “compose on the client” pattern.

**Claude Code should verify**

1. Count HTTP calls for 1 / 10 / 100 teams.
2. Whether list teams already (or could cheaply) return `memberIds`, collapsing the fan-out
   to two paged lists.
3. Authz: `getTeam` is richer than the list row; do not leak members the list would hide.

---

## Lower-priority linear write / side-effect fan-out

Not O(N²). Still statements or transactions inside loops; may dominate latency for large
payloads.

| Path | Shape | Notes |
|---|---|---|
| Pulse `open()` | `participants.forEach { PulseParticipants.insert }` | One transaction, N inserts; org-wide |
| `NotificationService.createAll` | N inserts, **one** transaction, then emailer | Pulse cycle events use this |
| Team KPI value/transition routes | `toNotify.forEach { notificationService.create(it) }` | **N transactions** (not `createAll`) — `teamkpis/TeamKpiRoutes.kt` |
| `NotificationEmailer.dispatch` | `UserService.read(recipientId)` **per notification**, then SMTP | Off the request path; pulse-open can be org-wide. Language/opt-out are why it re-reads |
| `POST /api/v1/users/import` | `UserService.create` per valid row | Intentional isolation; cap 200 |
| Team membership replace, dictionary PUT, goal milestones, 1:1 notes/items | One write per submitted item | Dictionaries / child lists are capped; **confirm team membership payload bound** |

Distinguish: one transaction with N statements vs N transactions vs async email. First
remediation candidates: bulk insert, `createAll` on Team KPI notify, recipient preload —
subject to existing failure-isolation semantics.

---

## Areas that appeared batched (try to disprove)

- `UserService.list(...)` — roles, disabled features, team refs, career profiles for the page
- Remaining `/teams/members` enrichments: feedback, goals, vacation, budget, career
- 1:1 list note/action **counts** (grouped); goal milestone tallies
- Days-off budget and next-vacation across user IDs
- Career-pyramid dictionary and user resolution
- Management-chain / team-tree: frontier/level, not per node (statement count O(height);
  a recursive CTE could still cut round trips)
- Dashboard summary: route-side composition of those batched helpers, not a nested loop

---

## Independent verification procedure

Claude Code should not merely re-read this note. It should:

1. Read `CLAUDE.md`, `.claude/docs/persistence.md`, `.claude/docs/list-endpoints.md`,
   `.claude/docs/testing.md`, and the feature docs for pulse, one-on-ones, performance
   reviews, team KPIs, and notifications.
2. Re-run a repository-wide search for database terminal operations inside `for`, `while`,
   `map`, `forEach`, `associateWith`, and recursive/hierarchy code. Include route-side
   service loops and `NotificationEmailer`.
3. Instrument executed SQL in integration tests or inspect database spans. Count **executions**,
   not Exposed query objects built in memory.
4. Exercise each candidate with geometrically increasing cardinality and report
   `Q(N)=2N+7`-style functions. Wall-clock alone is too noisy.
5. `EXPLAIN (ANALYZE, BUFFERS)` after statement counts. N+1 and slow individual SQL are
   separate problems.
6. Search for other SPA multipliers (`useQueries`, `listAll*`, `getX` inside `.map`).
7. Update **this file** with confirmed / refuted / changed beside every `QRY-*`, including
   evidence, measured counts, tested cardinalities, and the revision tested.

Pulse optimizations in particular require explicit verification that fill gates, authorization
ordering, k-anonymity, and user-id-free aggregation remain intact.

## Suggested measurement order

1. QRY-001 (highest product risk if cycle history and team count both grow)
2. QRY-003 (HR unbounded in T)
3. QRY-002 (hottest dashboard path, but paged)
4. QRY-004 / QRY-005 / QRY-006
5. Team KPI `create` vs `createAll` and emailer `UserService.read` fan-out
