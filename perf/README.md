# perf/ — repeatable performance measurement

Measurement only: nothing here changes a query, index, pool setting, SPA fetch or schema.
Anything that looks like a fix is a finding to record, not a commit.

```
perf/run.sh up            # the lettuce-perf compose project (own volume, ports 18080/15432, mail and Teams fully disabled)
perf/run.sh status
perf/run.sh down          # keeps the dataset; `down --wipe` deletes the perf volume (asks first)

perf/run.sh seed --wipe   # fresh volume -> generator -> verify.sql -> VACUUM ANALYZE -> snapshot (perf/snapshots/, git-ignored)
perf/run.sh restore       # snapshot -> database -> app up (the reproducible start of every run)
perf/run.sh k6 reviews-team-view --persona ceo-all --vus 1 --iterations 3 --run my-run
perf/run.sh k6 reviews-team-view --persona mixed --vus 50 --duration 3m --run my-run
perf/run.sh k6 dashboard --persona ceo --iterations 3          # one file per screen (perf/k6/*.js); without --persona VU n takes the scenario's personas round-robin (1 VU = the first one)
perf/run.sh k6 mixed-50vu --vus 50 --ramp-up 2m --duration 5m --think 3 8   # the realistic 50-user mix (writes! restore afterwards)
perf/run.sh pgss reset | dump <label>   # pg_stat_statements / table stats / auto_explain window (k6 wraps one around each run)
perf/run.sh all           # restore -> warm-up -> every scenario with pgss windows -> restore -> report
perf/run.sh report <run> [--baseline DIR]   # scripts/perf_compare.py: Δ vs a committed baseline (same datasetVersion only)
perf/run.sh baseline <run>                  # copy a run's small files into perf/baselines/<date>-<sha>/ (token check included)
perf/run.sh traces reviews-team-view --persona ceo-all   # Jaeger + OTLP export on, one iteration, traces exported + summarised (UI http://127.0.0.1:16686)
perf/run.sh jfr reviews-team-view --persona ceo-all --vus 50 --duration 2m [--c1] [--heap 512m]   # JFR CPU profile of a run
```

Results land in `perf/results/<run>/` (git-ignored; k6 summaries never carry the bearer tokens — before committing a baseline run `grep -rl eyJ perf/baselines`, it must print nothing); the committed numbers are `perf/baselines/<date>-<sha>/` plus
`perf/baselines/FINDINGS.md` (observations only).

The stack is a separate compose PROJECT (`-p lettuce-perf`), so the dev stack and its volume are
never touched. The long form (dataset contract, how to read `Server-Timing`, pg_stat_statements,
scenarios, baselines) is `.claude/docs/performance.md`; this file only names the commands.

The dataset generator is a Gradle task (`./gradlew :server:perfSeed`, test source set, see
`server/src/test/kotlin/perf/`); `perf/pg/verify.sql` asserts the dataset's invariants afterwards.
k6 itself is only the pinned
`grafana/k6` image (`K6_IMAGE` in `run.sh`) — no repo dependency.
