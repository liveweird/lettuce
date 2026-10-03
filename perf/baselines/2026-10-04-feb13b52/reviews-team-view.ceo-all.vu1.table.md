### reviews-team-view — ceo-all, 3 iterations/VU, 1 VU

requests 46, failed rate 0.00 %, responses without Server-Timing 0

#### ceo-all

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | app p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| probe | 3 | 2 | 3 | 1 | 1 | 2 | 3 | 2 |
| periods | 3 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| dictionaries | 9 | 2 | 2 | 1 | 1 | 2 | 2 | 2 |
| members | 18 | 69 | 79 | 66 | 75 | 78 | 222 | 11 |
| reviews | 12 | 11 | 22 | 9 | 10 | 12 | 7 | 2 |

| per screen load | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| requests | 3 | 15 | 15 | 15 |
| sequential wall ms | 3 | 435 | 446 | 447 |
| critical-path wall ms (est.) | 3 | 373 | 379 | 379 |
| db ms | 3 | 395 | 399 | 400 |
| statements | 3 | 1190 | 1190 | 1190 |
| transactions | 3 | 84 | 84 | 84 |