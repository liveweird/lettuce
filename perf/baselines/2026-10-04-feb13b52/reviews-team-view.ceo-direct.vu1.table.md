### reviews-team-view — ceo-direct, 3 iterations/VU, 1 VU

requests 31, failed rate 0.00 %, responses without Server-Timing 0

#### ceo-direct

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | app p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| probe | 3 | 3 | 3 | 1 | 1 | 2 | 3 | 2 |
| periods | 3 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| dictionaries | 9 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| members | 3 | 20 | 20 | 16 | 17 | 20 | 39 | 11 |
| reviews | 12 | 11 | 12 | 9 | 10 | 12 | 7 | 2 |

| per screen load | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| requests | 3 | 10 | 10 | 10 |
| sequential wall ms | 3 | 75 | 75 | 75 |
| critical-path wall ms (est.) | 3 | 46 | 46 | 46 |
| db ms | 3 | 58 | 59 | 59 |
| statements | 3 | 78 | 78 | 78 |
| transactions | 3 | 29 | 29 | 29 |