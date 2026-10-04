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

---

## Baseline `2026-10-04-acd9d3ed` — the full scenario set (`perf/run.sh all`), dataset v2

Everything below is from `perf/baselines/2026-10-04-acd9d3ed/` (13 per-screen scenarios + `reviews-team-view` + `mixed-50vu`; machine, limits, dataset in its `meta.json`; the per-screen table is in `.claude/docs/performance.md` "Baselines"). Dataset v2 is ~4–5× the v1 database (675 MB, all features) with spread/jittered timestamps; v1 numbers (F1–F6 above) are not comparable, but **statement and transaction counts of code paths that did not change reproduce exactly** (the CEO's reviews screen is still 15 requests / 1 190 statements / 84 transactions). "load" = one cold screen load of a fresh browser (no client cache, default tab/sort/`pageSize` 20); every first load includes the Shell's four queries. Statement counts below are `Server-Timing` `stmt`/`tx` medians; PostgreSQL evidence is `*.pgss.csv`/`*.tables.csv` (calls ÷ 3 iterations).

### F7. The pulse trend costs two statements and two transactions per cycle, per team: 264 statements for one team, 22 195 for HR's all-teams screen

`GET /pulse-surveys/trend?teamId=…&mode=direct` is `stmt=264 tx=263` for every team (130 cycles → 2 per cycle + ~4), 412 ms p50 at 1 VU, against 11–20 statements for the same screen's `results` and `comments` requests. HR's Pulse → Results with the default "all teams" view (`pulse-results.hr`) is **259 requests, 23 708 statements, 23 369 transactions per load, ~6.4 s elapsed** (35 s of summed request time, the batch's 6-way parallelism hiding the rest); the Trend tab alone is 89 requests / 22 195 statements. pgss of that run: `SELECT pulse_responses.id, cycle_id, user_id, enps, driver1 …` **21 840 calls per load, 119 908 rows**, and `SELECT COUNT(*) FROM pulse_participants WHERE cycle_id = $1 AND user_id IN (…)` **21 756 calls** — one pair per (team, cycle); each is a ~0.01 ms index probe (296 ms + 211 ms of PostgreSQL time in total), so the cost is again the round trips, not PostgreSQL. An IC or team lead opening the same tab pays it once for their own team (`trend` 247–259 transactions, 145–161 ms p50; their whole Results screen is 9 requests / ~290 statements). The CEO's "Teams I manage" cards answer `trend` in 15 statements — the CEO sits in no team and is not a pulse participant, so these requests are presumably cut short before the per-cycle loop (the k6 summaries do not break the status down; not verified). The transactions-per-cycle shape also means the pool's 20 connections are held for ~263 sequential transactions by one request.

### F8. The org chart is 95 requests and ~275 transactions: one `GET /teams/{id}` per team

`/org` (any persona): `teams` listAll, then **84 `GET /teams/{id}` (`stmt=6 tx=3` each) in parallel with the 6 `users` pages** — 496–559 statements, 275 transactions per load, 74–109 ms elapsed at 1 VU (the browser fans the 84 out; k6 batches 6 at a time). pgss: `SELECT teams.manager_id FROM team_members JOIN teams … WHERE user_id = $1` 236 calls per load and `SELECT teams."name", teams.manager_id, users."name" … ` 84 calls — one pair of lookups per team. `/teams` (admin and IC alike) is 11 requests / 70 statements, of which 6 are the `users` display-name pool.

### F9. Every "drill-down" screen spends ~60 % of its statements on the 6-page users pool

`useUserDisplayName` → `useAllUsers` fetches `users?pageSize=100&sort=id` page after page (6 pages for 522 users, `stmt=8–10 tx=2` each, ~7 ms) next to the document read: activity of a report as the CEO 11 requests / 99 statements (the activity request itself 13 statements / 41 ms), as a lead 83, HR audit of the CEO's log 67 (the request: 6 statements / 3 tx / 13 ms); days-off drill-down 94 (lead) / 76 (HR audit); 1:1 drill-down 80 / 67; impact-log 79 / 64; succession audit 65. The same pool rides the Teams screen and CreateFeedback/CreateOneOnOne.

### F10. The per-row `LIMIT 1` lookups of F1 scale with the page size: ~2.5 statements per row on `teams/members?view=managed`

On the new dataset the reviews screen reproduces F1 exactly (CEO 15 requests / 1 190 statements / 84 transactions; pgss: the two per-row statements **510 calls each per load**, 10 rows between them). Dashboard "Subordinates" with the stored "all reports" scope loads `members?view=managed&pageSize=20&includeIndirect=true`: **63 statements / 11 tx for a 20-row page** (CEO; direct scope 46, a lead's 7 reports 33–40) — ~13 fixed + ~2.5 per row. Every tab of the dashboard that renders cards (`first-load` 29–42 statements/21–27 tx, `peers-tab` 16/10, the `managers` list included) pays the Shell (F11) plus its own per-row enrichment. At 100 rows (the roster loops of the reviews screen) the same code is the 222 statements of F1.

### F11. The Shell costs 13 statements and ~9 transactions on every page load; a list page's own query is 3

`shell-user` (`users/{me}`) 5–6 statements/3 tx, `shell-probe` (the managed-teams probe) 3/2, `shell-alerts` 2/2, `shell-bell` 3/2: every "first load" of a one-list screen is 16–21 statements / 11 transactions of which the list is 3–4 / 2 (own 1:1s, own impact log, own KPIs …; the pgss `revoked_tokens` blocklist read is one of the 2 transactions of every request, F5). `dashboard/summary` is the single heaviest dashboard request: 15 statements / 10 transactions. The bell is O(1) (H6 **confirmed**): badge 3 statements / 2 tx, drawer 3 per page, independent of the volume of notifications (91 812 rows).

### F12. 1:1 "latest only" is the slowest statement of the whole baseline; the big-table seq scans sit on the manager-wide lists

`one-on-ones?view=managed&latestOnly=true` for the CEO: 15 statements / 2 tx but **49 ms against 8 ms for the plain list** (leads 37 vs 6 ms): pgss shows one 41.7 ms-mean statement over `one_on_one_meetings` with **1.04 M shared-buffer hits per 3 calls** (~347 k buffers per call, 10 rows returned) — `max_exec_ms` 42.3 ms, the highest of any window, still below `auto_explain.log_min_duration` (50 ms), so **every `*.auto_explain.ndjson` is empty again**. `view=team&includeIndirect=true` (CEO) 40 ms / 29 statements. The CEO windows of the manager-wide lists are also where the large tables show **sequential scans**: `feedbacks` 30 scans / 919 800 tuples read for three loads of the feedback screens (10 per load of a 30 660-row table; `team` with `includeIndirect` 32 ms vs 11 ms direct), `one_on_one_meetings` 12 scans / 795 600 tuples (6 full reads of 132 600 rows), `feedback_subjects` (activity log of a report), `impact_log_entries` (91 980 = 3 full reads; `impact-log` `managed&includeIndirect` 16 ms, its count statement the second-slowest at 22.9 ms). Everything else on the big tables is an index probe.

### F13. Days off: set-based statements (10–13) but the chain-wide budgets read is the costliest of the screen

`days-off/budgets?view=managed&includeIndirect=true` for the CEO: 13 statements / 3 tx and **69 ms (6 ms for the direct scope)**; `calendar` with `scope=managed&includeIndirect=true` 10 statements / 16 ms (4 ms direct); the entries list 10–12 statements / ~5–11 ms. The budget math is per-person but issued as a handful of set-based statements (the cost scales with the number of people in scope, not the statement count). H3 for the days-off half ("scales with table size, not page size") is therefore **neither confirmed nor refuted by statement counts**: the count is O(1), the time grows ~10× with the chain.

### F14. Under load the reviews team view degrades as in F4, and the realistic mix does not saturate the stack

Closed loop at 50 VUs on the same screen (sequential sum / estimated critical path, 1 VU in brackets): CEO 14.7 s / 12.6 s (0.50 s / 0.45 s), director 1.7 s / 1.1 s (68 ms), lead 0.62 s / 0.32 s (29 ms), HR 3.3 s / 1.6 s (85 ms), 0 failed requests; in the five-persona mixed closed loop the CEO is 9.4 s. **`mixed-50vu` (ramp 0 → 50 over 2 min, hold 5 min, think 3–8 s, VUs round-robin over 4 ICs/2 leads/director/CEO/HR): 10 074 requests (≈ 23/s), 3 252 iterations, 0 failed requests, 0 write conflicts** (47 1:1 creates → 201, 153 feedback create + send → 201/204, 129 goal-progress updates → 204). `docker stats` over the run: **the app at 21 % CPU on average, peak 101 % of its 200 % limit; PostgreSQL 5 % average, peak 11 %** — a realistic mix with think time is far from saturation; the slow tail is single requests: worst per-screen p95 across personas 0.73 s (CEO "1:1 create", which first lists ~510 reports in 6 pages: `reports` `stmt=134 tx=11` for the CEO, 69–73 ms), 0.62 s (a sign-in), 0.40 s (CEO received feedback), ≤ 0.3 s for everything else; median screen load 6–35 ms. Write costs (statements/transactions): feedback create 12/7, send 16/7, 1:1 create 18/8 (its carry-over is server-side, no extra request), goal progress 9/5. The app-saturation of F4 was sampled with `docker stats` only during this realistic run in this baseline, not during the closed-loop runs, so **H7 (pool queueing vs PostgreSQL saturation) stays undecided**; F4's CPU-bound reading of the closed loop is unchanged.

### F15. Sign-ins are bcrypt-bound: ~7 per second on the 2-CPU app, and a few 429s under a same-account storm

`POST /login`: 259 ms at 1 VU (bcrypt cost 12 on the C1-only JVM), anonymous, so no `Server-Timing`; 3–5 statements in the pgss window. **At 50 VUs ramped over 30 s and held for 1 min: 695 sign-ins at ~7.3/s, median 6.1–6.6 s, p95 7.5–8.3 s** — CPU bound on the app's two CPUs (≈ 2 / 0.26 s). **5 of 695 (0.72 %) answered `429`** (the run is marked in `meta.json`; a diagnostic repeat with the status breakdown showed 8 of 407, all on the admin/director/lead/IC accounts); the development-mode per-IP bucket is 1 000/min, well above the achieved rate, so the cause (per-account throttle state, `login_lockouts` shows 2 sequential scans) was not identified — an observation, not an attribution.

### F16. What the other screens cost (no finding beyond the numbers)

Own-document lists (1:1s, feedback received/provided/team, impact log, KPIs, succession) 1–5 statements per list request (`stmt` 3–8 tx 2, 2–16 ms at 1 VU; `kudos` 22 statements over 6 requests incl. the Shell); the 1:1 detail view of the deepest carry-over chain (6 links): `GET {id}` 15 statements / 3 tx, `events` 16 / 4, the action-item history 23 / 4, 6–9 ms each; KPI detail 8 requests / 27–33 statements; `calendar` 5 requests / 19–22 statements. Succession, KPIs and the 1:1 detail are flat in the dataset's size. Per-row suspects from the pgss windows (≥ 30 calls per load, `SELECT $1` validations excluded), most to least: the two pulse statements of F7 (21 840 / 21 756), the F10 pair (510 + 510), `revoked_tokens` (360 — one per authenticated request), the team-resolution statements of the pulse results (336 each: `team_members` by team, `teams` by id, `team_members.team_id/user_id`), `pulse_cycles` (252), the org chart pair of F8 (236 + 84), the CEO's pulse team-tree statements (169 each).

### Hypotheses after the full baseline

H1 confirmed (F2). **H2 refuted** (F1/F10: 222 statements and 11 tx per 100-row page). **H3** refuted for 1:1 lookups (F5), neither for days off (F13). H4 (decryption vs C1 JSON) not answerable without a CPU profile (M4). **H5 refuted:** the activity log is not the slowest request — HR's audit of the CEO is 6 statements / 13 ms, a manager reading a report's log 13 statements / 41 ms; the slowest single requests are the pulse trend per team (412 ms) and the CEO's chain-wide days-off budgets (69 ms). **H6 confirmed** (F11). H7 undecided (F14).

## Baseline `2026-10-04-3076bbd4` — front end in a real Chromium (M5), dataset v2 — observations only

Source: `perf/baselines/2026-10-04-3076bbd4/web/*.json` (5 measured iterations + a cold run per case, medians) and `bundle.json`; settings and caveats in `web-meta.json`. "Settled" = every expected request finished, no loader, stable for 400 ms. Numbers are one laptop's, relative; counts and bytes are exact. Ids are `W<n>` so they never collide with the back-end `F<n>` series.

### W1. Every screen has a ~290–320 ms floor before its own data even starts to load

Screens whose data is trivial (`activity-log.*.own` 297–321 ms, `one-on-ones.ic.own` 312 ms, `days-off.*.calendar-member` 294–296 ms) all settle in ≈ 300 ms with a request critical path of 14–30 ms. The waterfall shows why: the four Shell requests start at ≈ 69 ms, the screen's own first request only at ≈ 274 ms — ~200 ms of the page's chunks being fetched, parsed and rendered (67 static requests, 526 kB transferred / 1.8 MB decoded per load; CDP `scriptMs` ≈ 77 ms, `taskMs` ≈ 112 ms on the activity page). LCP is 284–324 ms on those screens (88–96 ms on the dashboard/reviews/1:1 lists, whose largest paint is the early shell).

### W2. The SPA's static assets are served without any cache validators, so a warm load re-fetches almost everything

`curl -I` of a hashed chunk (`/assets/react-….js`) on the perf app returns only the security headers, `Content-Length` and `Content-Type` — no `Cache-Control`, `ETag` or `Last-Modified` (also none on `/`). Consistently, the measured warm iterations (same browser context, HTTP cache available) transfer 526 kB of static assets per load against 568 kB for the cold first load (`activity-log.ceo.own`: `staticTransferBytes` 526 195 vs 567 537, 67 files either way). Cold and warm settle times are therefore indistinguishable in every case (`cold.load.settledMs` vs `median.load.settledMs`), which is also why W1's floor does not shrink on a repeat visit on loopback. On a real network the repeat-visit cost is the full ~0.5 MB.

### W3. The reviews team view: the browser is not the bottleneck, the request chain is

CEO "all reports" settles in **789 ms** (cold 765) at 1× CPU and 904 ms at 4× CPU; the load is 19 requests, **1 204 statements, 93 transactions**, with an API critical path of 496 ms of those ~790 ms. Main-thread cost is small: 0 long tasks at 1×, `scriptMs` 222, `taskMs` 361, 52 MB heap; at 4× CPU 3 long tasks (blocking 100 ms). The waterfall is the F2 picture seen from the browser: the roster chain is 6 sequential `teams/members?view=managed&includeIndirect=true` pages (≈ 90 ms each, 222 statements and 11 transactions per full page) running beside 4 review pages (≈ 16 ms each). Other personas: director-all 361 ms (11 requests, 165 statements), lead 340 ms (11 / 63), HR auditor 377 ms (21 requests, 90 statements), CEO direct 374 ms (14 / 92). H1 is confirmed end to end: time ≈ pages × per-page latency.

Interactions after the load are cheap and client-side (no request): sort a column 60–76 ms, next page 42–52 ms (INP 24–40 ms), the Distribution view 340–363 ms (the lazily loaded recharts chunk), widening direct → all reports for the CEO 414 ms (a fresh 6-page roster chain). **Quadrants is the only heavy render**: a 57–85 ms long task and INP 64–88 ms at 1×, **226 ms of long tasks and INP 240 ms at 4× CPU** (CEO, ~510 rows). Cumulative layout shift of the load is 0.12–0.13 for every persona with a long roster (CEO-all, director-all, HR) — above the 0.1 "good" line; 0.058 for CEO-direct — i.e. the table's late fill moves content.

### W4. HR's pulse results screen is the heaviest screen of the SPA: 260 requests, 23 711 statements, 7.8 s

`pulse-results.hr.results` (HR has no team of their own, so the default view is all 84 teams): **260 requests (84 each of `results`, `trend`, `comments`), 23 711 statements and 23 371 transactions** for one page load, settling in **7.8 s** (cold 7.8 s). Each of the 84 `trend?teamId=…` requests is `stmt=264 tx=263` (F7, per team) and takes ≈ 6.7–6.8 s wall while its `db` window is ≈ 200–300 ms — wall ≫ db window; consistent with the requests waiting for the 20-connection pool and the browser's 6-connection-per-host cap (not separately proven). The browser pays too: CDP `scriptMs` 1 217, `taskMs` 1 832, **159 MB JS heap**, 336 layouts and 617 style recalculations (84 cards). The HR `trend` tab alone is 90 requests / 22 198 statements / 6.7 s; HR's participation tab 396 ms. For non-HR roles the same tab is cheap: IC and lead `results` ≈ 790–800 ms (10 requests, ~294 statements, 277 tx — the 2–3 teams they belong to), CEO's 319 ms (8 requests).

### W5. The org chart: 95 requests, 275 transactions, and the only visible main-thread block after the data arrives

`org-chart.*` (identical for admin, IC and CEO): 95 requests (one `GET /teams/{id}` per team + the 6-page users pool), 496 statements / 275 transactions, request span 349 ms (critical path 146 ms, summed request time 3.4 s — the parallel `teams/{id}` calls queue behind each other), settled in 653–674 ms. After the data, 2 long tasks totalling 254 ms (max 183 ms, blocking 154 ms) — the chart layout; the same page's `scriptMs` is 279. No back-end cost differs by persona (F8).

### W6. The remaining screens sit at the W1 floor, with these exceptions

Everything in `dashboard.*`, `one-on-ones.*`, `days-off.*`, `activity-log.*` settles in 294–371 ms, i.e. at the floor plus one or two quick requests; `dashboard.*.subordinates` (75 statements, 34 tx) 347–370 ms; the activity/1:1/days-off drill-downs (`*.report`, `*.audit`, `*.drilldown*`) 345–371 ms with 11 requests (the 6-page users pool again, F9) and 67–100 statements. Only exceptions: `days-off.ceo.calendar-managedAll` **494 ms** (the chain-wide calendar: one long task, blocking 95 ms, 13 kB over the wire — client render of ~510 rows) and `days-off.hr.calendar-org` 358 ms (12 kB). `Server-Timing` reached the browser on every API request of every case (`noServerTiming` = 0 in all 74 files), so each waterfall carries `stmt`/`tx` per request.

### W7. Bundle: a 492 kB entry chunk, a 1.73 MB initial payload, 314 chunks

`bundle.json` (raw / gzip / brotli): entry `index-….js` **491.7 / 143.6 / 121.5 kB** (Vite prints 503.5 kB in 1000-byte units); the **initial payload** — entry + the modulepreload/stylesheet links of `index.html` (`i18n` 365.8 kB, `index` css 235.2 kB, `react` 213.7 kB, `dates` 167.3 kB, one 91.8 kB shared chunk and small ones) — is **1 726 732 B raw / 480 717 B gzip**; all 314 chunks together 4.70 MB raw / 1.43 MB gzip / 1.22 MB brotli. The largest lazy chunks: `emoji-data` 420 kB, `grid-chart` 360 kB, `MarkdownEditor` 300 kB, `lexical` 274 kB, `Changelog` 258 kB, `OrgChart` 216 kB. (The vite.config chunk groups keep each lazy payload under the 500 kB warning limit; only the entry still exceeds it.)

## Found by `QueryBudgetTest` (M3, 2026-10-04) — observations only

### F17. Two more per-row lookups the screen baselines hid: `teams/members?view=managers` and the 1:1 lists

`QueryBudgetTest` measures `stmt`/`tx` at 1 vs 50 rows for the same caller (test application, so the counts include the blocklist read of every request). Besides the F1/F10 pair on `view=managed` (**+98 statements for 49 more rows — 18 → 116, `tx` constant at 11**; with `includeIndirect` 22 → 120), two endpoints the F-entries did not list as per-row are O(n) too, both with a constant transaction count:

- **`GET /teams/members?view=managers`: 8 → 57 statements (+1 per row), `tx` 7 → 7.** `OneOnOneService.latestMeetingStats` → `latestStatsByKey` issues one indexed `LIMIT 1` per manager row (the code comment calls it "a handful" of dashboard cards); the other two enrichments of the view are batched. The CEO's dashboard "Managers" cards stay small, but a person who sits in many teams pays it per team.
- **`GET /one-on-ones?view=managed` (also with `latestOnly=true`): 6 → 55 statements (+1 per distinct (manager, subordinate) pair on the page), `tx` 2 → 2.** The `isLatest` flag is one `latestMeetingOfPair` `LIMIT 1` per pair (`OneOnOneService.list`, the comment there states the cost profile). In the dataset-v2 baseline this is the "15 statements for the CEO's list" of F12 (≈ 5 fixed + one per direct report), and it is why the plain list was never statement-bound; a page of 100 distinct pairs is ~105 statements.

Everything else the test measured is flat in the number of rows: users, teams, `teams/{id}`, `teams/members?view=member`, the dashboard summary (10 statements / 8 `tx`), goals, performance reviews (managed and the HR `all` view), the four feedback views (`team` direct only), team KPIs (managed, all), impact log (own, managed), succession plans (`own` only), days off (entries direct only; budgets and calendar both direct and `includeIndirect`), notifications, shares (`withMe`, `byMe`) and the activity log. The pulse trend's slope is confirmed at exactly 2 statements and 2 transactions per closed cycle (F7). The test pins today's numbers as the CI budget (`.claude/docs/performance.md`, "Query budgets"); nothing was changed to obtain them.

### Not measured here (so no finding)

Real-device and RUM browser data (the single-machine Chromium runs are the W-series above), the JVM CPU profile and traces (M4), `Server-Timing` is absent on anonymous routes (login, refresh, password reset) by design, the feedback detail/edit screens, the per-status split of the pulse fill-gate responses, the closed-loop saturation CPU split of `docker stats` for the 50-VU single-screen runs, and anything about production network latency (the extrapolation note of F6 applies to every count above).
