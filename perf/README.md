# perf/ — repeatable performance measurement

Measurement only: nothing here changes a query, index, pool setting, SPA fetch or schema.
Anything that looks like a fix is a finding to record, not a commit.

```
perf/run.sh up            # the lettuce-perf compose project (own volume, ports 18080/15432, mail and Teams fully disabled)
perf/run.sh status
perf/run.sh down          # keeps the dataset; `down --wipe` deletes the perf volume (asks first)
```

The stack is a separate compose PROJECT (`-p lettuce-perf`), so the dev stack and its volume are
never touched. The long form (dataset contract, how to read `Server-Timing`, pg_stat_statements,
scenarios, baselines) is `.claude/docs/performance.md`; this file only names the commands.

The dataset generator is a Gradle task (`./gradlew :server:perfSeed`, test source set, see
`server/src/test/kotlin/perf/`); `perf/pg/verify.sql` asserts the dataset's invariants afterwards.
`seed`, `snapshot`, `restore`, `pgss`, `k6`, `report` and `all` arrive with the later milestone steps.
