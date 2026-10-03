### reviews-team-view — lead, 3 iterations/VU, 1 VU

requests 22, failed rate 0.00 %, responses without Server-Timing 0

#### lead

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | app p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| probe | 3 | 3 | 3 | 1 | 1 | 2 | 3 | 2 |
| periods | 3 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| dictionaries | 9 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| members | 3 | 18 | 19 | 15 | 16 | 18 | 33 | 11 |
| reviews | 3 | 4 | 4 | 3 | 3 | 4 | 5 | 2 |

| per screen load | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| requests | 3 | 7 | 7 | 7 |
| sequential wall ms | 3 | 33 | 34 | 34 |
| critical-path wall ms (est.) | 3 | 18 | 19 | 19 |
| db ms | 3 | 24 | 24 | 24 |
| statements | 3 | 49 | 49 | 49 |
| transactions | 3 | 23 | 23 | 23 |