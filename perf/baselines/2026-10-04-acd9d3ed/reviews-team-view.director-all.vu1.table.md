### reviews-team-view — director-all, 3 iterations/VU, 1 VU

requests 22, failed rate 0.00 %, responses without Server-Timing 0

#### director-all

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | app p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| probe | 3 | 2 | 2 | 1 | 1 | 2 | 3 | 2 |
| periods | 3 | 2 | 2 | 1 | 1 | 1 | 2 | 2 |
| dictionaries | 9 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| members | 3 | 54 | 62 | 51 | 58 | 62 | 134 | 11 |
| reviews | 3 | 6 | 7 | 5 | 6 | 6 | 6 | 2 |

| per screen load | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| requests | 3 | 7 | 7 | 7 |
| sequential wall ms | 3 | 68 | 78 | 79 |
| critical-path wall ms (est.) | 3 | 54 | 62 | 63 |
| db ms | 3 | 61 | 69 | 69 |
| statements | 3 | 151 | 151 | 151 |
| transactions | 3 | 23 | 23 | 23 |