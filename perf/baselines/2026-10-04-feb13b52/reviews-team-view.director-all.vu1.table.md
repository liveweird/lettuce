### reviews-team-view — director-all, 3 iterations/VU, 1 VU

requests 22, failed rate 0.00 %, responses without Server-Timing 0

#### director-all

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | app p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| probe | 3 | 2 | 3 | 1 | 2 | 2 | 3 | 2 |
| periods | 3 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| dictionaries | 9 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| members | 3 | 45 | 47 | 41 | 44 | 46 | 134 | 11 |
| reviews | 3 | 6 | 6 | 5 | 5 | 6 | 6 | 2 |

| per screen load | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| requests | 3 | 7 | 7 | 7 |
| sequential wall ms | 3 | 61 | 63 | 63 |
| critical-path wall ms (est.) | 3 | 45 | 47 | 47 |
| db ms | 3 | 52 | 54 | 55 |
| statements | 3 | 151 | 151 | 151 |
| transactions | 3 | 23 | 23 | 23 |