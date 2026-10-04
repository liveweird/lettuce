### reviews-team-view — ceo-direct, 3 iterations/VU, 1 VU

requests 31, failed rate 0.00 %, responses without Server-Timing 0

#### ceo-direct

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | app p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| probe | 3 | 2 | 2 | 1 | 1 | 2 | 3 | 2 |
| periods | 3 | 1 | 1 | 1 | 1 | 1 | 2 | 2 |
| dictionaries | 9 | 1 | 2 | 1 | 1 | 1 | 2 | 2 |
| members | 3 | 17 | 18 | 15 | 15 | 17 | 39 | 11 |
| reviews | 12 | 10 | 11 | 9 | 10 | 11 | 7 | 2 |

| per screen load | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| requests | 3 | 10 | 10 | 10 |
| sequential wall ms | 3 | 63 | 66 | 67 |
| critical-path wall ms (est.) | 3 | 41 | 42 | 42 |
| db ms | 3 | 55 | 56 | 56 |
| statements | 3 | 78 | 78 | 78 |
| transactions | 3 | 29 | 29 | 29 |