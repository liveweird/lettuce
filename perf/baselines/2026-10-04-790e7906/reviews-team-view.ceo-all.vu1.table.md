### reviews-team-view — ceo-all, 3 iterations/VU, 1 VU

requests 46, failed rate 0.00 %, responses without Server-Timing 0

#### ceo-all

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | app p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| probe | 3 | 2 | 2 | 1 | 1 | 2 | 4 | 2 |
| periods | 3 | 1 | 2 | 1 | 1 | 1 | 2 | 2 |
| dictionaries | 9 | 2 | 3 | 1 | 1 | 2 | 2 | 2 |
| members | 18 | 17 | 24 | 15 | 22 | 24 | 24 | 11 |
| reviews | 12 | 7 | 10 | 6 | 7 | 8 | 7 | 2 |

| per screen load | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| requests | 3 | 15 | 15 | 15 |
| sequential wall ms | 3 | 139 | 164 | 167 |
| critical-path wall ms (est.) | 3 | 101 | 124 | 126 |
| db ms | 3 | 115 | 137 | 140 |
| statements | 3 | 183 | 183 | 183 |
| transactions | 3 | 84 | 84 | 84 |