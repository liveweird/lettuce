### reviews-team-view — ceo-all, 3 iterations/VU, 1 VU

requests 46, failed rate 0.00 %, responses without Server-Timing 0

#### ceo-all

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | app p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| probe | 3 | 2 | 3 | 1 | 1 | 2 | 4 | 2 |
| periods | 3 | 2 | 2 | 1 | 1 | 1 | 2 | 2 |
| dictionaries | 9 | 1 | 2 | 1 | 2 | 2 | 2 | 2 |
| members | 18 | 18 | 21 | 16 | 18 | 20 | 24 | 11 |
| reviews | 12 | 6 | 7 | 5 | 7 | 7 | 7 | 2 |

| per screen load | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| requests | 3 | 15 | 15 | 15 |
| sequential wall ms | 3 | 142 | 145 | 145 |
| critical-path wall ms (est.) | 3 | 107 | 110 | 110 |
| db ms | 3 | 119 | 120 | 120 |
| statements | 3 | 183 | 183 | 183 |
| transactions | 3 | 84 | 84 | 84 |