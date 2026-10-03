# Findings (observations only)

**Nothing in this file is a change request that has been made.** The measurement programme never alters a
query, index, pool setting, SPA fetch or schema (`.claude/docs/performance.md`); an entry here is what the
numbers show, with its evidence, so a later and separate decision can use it. Numbers come from the baseline
directory named in each entry, taken on one laptop under OrbStack (`meta.json` lists the machine, the limits,
the dataset). **Statement and transaction counts are exact and comparable across machines; milliseconds are
not — read them relatively.** Baselines compare only within one `datasetVersion`.

## Baseline `2026-10-04-feb13b52` — Performance → Team's performance (`reviews-team-view`), dataset v1

### F1. `GET /teams/members?view=managed` costs ~222 statements and 11 transactions per full page, and ~200 of the statements are two per-row lookups

*Evidence.* `Server-Timing` per request (`reviews-team-view.ceo-all.vu1.table.md`): a 100-row page of the CEO's
`includeIndirect=true` roster is `stmt=222 tx=11` on every full page (director's 50-person page: 134/11; a lead's
7-person page: 33/11). The CEO's screen load is 15 requests, **1 190 statements and 84
transactions** (`reviews-team-view.ceo-all.vu1.pgss.csv`, three loads → `calls` ÷ 3):

| statement (template) | calls per screen load | rows returned per screen | PG time per screen |
|---|--:|--:|--:|
| `SELECT id, meeting_date FROM one_on_one_meetings WHERE manager_id = $1 AND subordinate_id = $2 AND marked_as_deleted = $3 ORDER BY meeting_date DESC, id DESC LIMIT 1` | **510** | 10 | 19.4 ms |
| `SELECT performance_reviews.id, start_month, end_month, status FROM performance_reviews JOIN review_periods … WHERE manager_id = $1 AND subordinate_id = $2 … ORDER BY start_month DESC … LIMIT 1` | **510** | 10 | 4.2 ms |
| the 8 batched enrichment queries + list/count/chain walk | 5–10 each (once per page, or the chain walk per level) | — | ≈ 10 ms together |

The two repeated statements are `OneOnOneService.latestStatsByKey` (`oneonones/OneOnOneService.kt:205-220`, reached
through `latestMeetingStatsBySubordinate`) and `PerformanceReviewService.latestReviewsBySubordinate`
(`reviews/PerformanceReviewService.kt:481-510`): one indexed `LIMIT 1` per row, inside one transaction each (their
code comments say the set "is one page of dashboard cards — a handful"; a managed page is up to 100 rows, and for the
CEO's chain 510). They answer the *directional* question "the latest 1:1 / review the **caller** ran with this person",
so for a transitive (not direct) report the answer is empty by construction: **500 of the 510 lookups of each kind
return no row** (`rows` = 10 per screen, the CEO's ten direct reports).

*Reading.* Nothing is slow inside PostgreSQL — the 52 statements of the window add up to ~34 ms of execution per
screen load while the screen's `db` windows sum to ~395 ms — the cost is the number of sequential round trips (each
statement is its own round trip; ~0.3 ms apiece here, on the loopback of one machine). Hypothesis H2 ("~10–16
statements and ~1 transaction per page") is **refuted** for this endpoint: 222/11.

### F2. At 1 VU the CEO's screen is ~0.44 s; the roster chain is ~86 % of it, in 6 sequential pages

`ceo-all`, 3 iterations (after a warm-up; every iteration is a cold screen load, no client cache — in the SPA periods
and dictionaries have a 5-minute `staleTime`): sequential sum **435 ms p50** (446 p95), estimated browser critical
path (roster chain ‖ periods → reviews) 373 ms. By chain (`chain_*` metrics): the **roster chain 373 ms — 6 pages (the
511-person chain: 5 full pages of 100 at ~69 ms, a last page of 11), 1 151 statements, 66 transactions**; the
reviews chain 46 ms (4 pages, 28 statements: the CEO sees 301–400 reviews of the current period — other managers'
DRAFTs stay private); probe, periods and the three dictionaries 2–5 ms each. H1 ("dominated by the sequential
page count") is **confirmed for the roster chain** — pages × per-page latency, where the per-page latency is the
222-statement fan-out of F1, not any single statement (the costliest statement of any 1-VU window executed in
≤ 0.5 ms, `max_exec_ms`). The same screen for a director (50 reports) is 61 ms, for team leads 33 and 31 ms, for HR
(auditor scope: 6 `users` pages of 8 statements + 6 `view=all` review pages) 88 ms. (There is no IC row: an IC never
sees this tab; ICs belong to the later scenarios.)

### F3. Every transaction is a pool acquire + a REMOTE validation round trip: ~86 `SELECT $1` per CEO screen, on top of the 1 190 statements

`SELECT $1` (the r2dbc-pool REMOTE validation, `.claude/docs/persistence.md` "Connection pool") runs ~86× per CEO
screen load (pgss `calls` ÷ 3, incl. the one login) — one per transaction (`tx=84`) — as additional round trips on top of
the 1 190 Exposed statements; they are not part of the `stmt` count (`stmt` counts what Exposed dispatched). A managed roster page's 11 transactions are consistent with the
JWT blocklist read + the list/count/chain walk + the eight enrichment services of `teams/TeamRoutes.kt:199-227`
(not attributed one by one: Exposed's interceptor counts, it does not label).

### F4. At 50 concurrent VUs the application container, not PostgreSQL, is the first thing to saturate

Closed-loop 50 VUs, no think time, the SHIPPED JVM flags (SerialGC, `-Xmx256m`, C1-only), app `cpus: 2`: `docker stats`
every 4 s during a 60 s mixed run (`saturation-docker-stats.txt`) shows the **app at 196–203 % CPU (its limit) and
PostgreSQL at 40–46 % of its 2 CPUs**; `pg_stat_activity` showed 20 backends (the pool's `maxSize`) in the first, superseded run of this scenario (not re-sampled). Effects
(`reviews-team-view.mixed.vu50.table.md`, 3 min, ~300 requests/s, 0 failed requests, 0 responses without
`Server-Timing`):

* a 2-statement endpoint (`/review-periods`, `stmt=2 tx=2`) answers in **~89 ms p50 / 108 p95** under load against 2 ms
  at 1 VU; every endpoint sits at roughly +90 ms (queueing, not work);
* the roster page of the CEO is 1.1 s p50 / 1.3 s p95 (69 ms at 1 VU); the CEO screen is **7.3 s sequential, ~6.3 s on
  the browser critical path** with the mixed load (10.6 s / 8.8 s when all 50 VUs are the CEO, `…ceo-all.vu50`);
* `db;dur` rises in lockstep with wall time (`db` p95 1.23 s of a 1.28 s wall for the CEO page) although PostgreSQL's
  slowest single execution in any 50-VU window was 7.2 ms — `db;dur` is the sum of statement *windows* (dispatch to the
  next boundary), so under CPU saturation it contains the application's own scheduling delay. **At 50 VUs read
  `db;dur` as "time inside the transaction", not as database time**;
* the slow-request log (`PERF_SLOW_REQUEST_MS` = 1000): in the first, superseded complete run of this scenario it wrote
  4 891 `request.slow` lines, **all of them `GET /api/v1/teams/members`** (statement windows up to ~97 ms against
  ≤ 7.2 ms of PostgreSQL execution); not re-counted for the final baseline (the container logs left with the stack).

H7 ("at 50 VUs the pool (20) queues before PostgreSQL saturates") is **neither confirmed nor refuted**: PostgreSQL is far
from saturated, the pool was fully used (20 backends, first run), and the app is CPU-bound — pool queueing and CPU queueing are
indistinguishable with `Server-Timing` alone. JFR / traces (M4) decide. The same applies to H4 (rating decryption vs
C1 JSON): not answerable yet.

### F5. The big tables are never seq-scanned; everything on this screen is an index lookup

`*.tables.csv` of every window: `one_on_one_meetings`, `goals`, `feedbacks`, `performance_reviews` and
`one_on_one_action_items` (127 MB; 3 index scans in the CEO window) show `seq_scan = 0` and only `idx_scan`;
`one_on_one_notes` (131 MB) is not touched by this screen at all (absent from every table CSV). The seq-scanned tables
are the small ones (`users` 522 rows, `team_members`, `teams`, `review_periods`, `dictionary_entries`,
`user_disabled_features`) where the planner rightly prefers a scan, and **`revoked_tokens` (0 rows): exactly one seq
scan per authenticated request — the JWT blocklist read** (measured: 45 scans for 45 authenticated requests in the
CEO window, 21/21 for a lead, 54/54 for HR; the pgss `calls` of the blocklist statement equal the scans). **No
statement of any window reached `auto_explain.log_min_duration` (50 ms)** — every `*.auto_explain.ndjson` was empty
(not committed). H3 ("`latestMeetingStatsBySubordinate`/`remainingByUserIds` scale with table size, not page size")
is, for the 1:1 lookup, **refuted**: it scales with the number of rows (calls = rows), each call being a
constant-time index probe (0.037 ms mean over a 132 600-row table); `remainingByUserIds` cannot be judged yet — the
days-off tables are empty in dataset v1 (planned for M2).

### F6. Smaller observations

* HR (auditor scope, no team) fires one extra roster request the SPA's first render issues before the managed-teams
  probe resolves (`stray-roster`, `view=managed` page 1, total 0) — replayed, 18 requests per screen load. The SPA may additionally issue one stray `view=managed` reviews page 1 for HR if the periods resolve before the probe (a race; unverified, not replayed).
* `days_off_pool_types` is read by two statements, once each per roster page → 12 reads per CEO screen for a
  1-row registry (6 calls each per screen in `…ceo-all.vu1.pgss.csv`; presumably the days-off enrichment, not attributed).
* The reviews list (`performance-reviews?view=managed&includeIndirect=true`) is cheap for what it does — 5 ratings
  decrypted per row, 100 rows per page in ~11 ms wall (`stmt=7 tx=2`).
* Cold vs warm: the very first CEO screen load after the app booted took ~620 ms (smoke run) against 435 ms in the
  warmed baseline; the baseline runs are preceded by a 3-iteration warm-up over every persona.

### Not measured here (so no finding)

H5 (activity log), H6 (notifications bell), the 1:1 lists/summaries, the dashboard, days off, KPIs, pulse, impact log,
succession — M2 scenarios on the full dataset. Browser rendering (M5), the JVM CPU profile (M4), a production-sized
database and network latency between app and database — never on this stack: if the production app→database round
trip is, say, 1 ms rather than ~0.1 ms, F1's 1 190 sequential statements plus F3's 84 validation round trips scale
with it (an extrapolation to check against production `Server-Timing` with `PERF_SERVER_TIMING=true`, not a measurement).
