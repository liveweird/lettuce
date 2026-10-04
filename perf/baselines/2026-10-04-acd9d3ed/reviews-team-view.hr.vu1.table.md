### reviews-team-view — hr, 3 iterations/VU, 1 VU

requests 55, failed rate 0.00 %, responses without Server-Timing 0

#### hr

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | app p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| probe | 3 | 2 | 2 | 1 | 1 | 2 | 3 | 2 |
| periods | 3 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| dictionaries | 9 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| members | 3 | 2 | 2 | 1 | 1 | 2 | 3 | 2 |
| users | 18 | 7 | 8 | 6 | 7 | 7 | 8 | 2 |
| reviews | 18 | 6 | 7 | 5 | 6 | 7 | 3 | 2 |

| per screen load | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| requests | 3 | 18 | 18 | 18 |
| sequential wall ms | 3 | 85 | 89 | 90 |
| critical-path wall ms (est.) | 3 | 41 | 43 | 43 |
| db ms | 3 | 69 | 70 | 71 |
| statements | 3 | 80 | 80 | 80 |
| transactions | 3 | 36 | 36 | 36 |