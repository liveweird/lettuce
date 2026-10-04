### dashboard — hr, 3 iterations/VU, 1 VU

requests 19, failed rate 0.00 %, responses without Server-Timing 0

#### hr / first-load

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 22 | 23 | 23 |
| summed request ms | 39 | 45 | 45 |
| db ms | 27 | 34 | 35 |
| statements | 29 | 29 | 29 |
| transactions | 21 | 21 | 21 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 4 | 5 | 3 |
| shell-probe | 3 | 5 | 5 | 3 | 3 | 3 | 2 |
| shell-alerts | 3 | 3 | 5 | 2 | 3 | 2 | 2 |
| shell-bell | 3 | 4 | 4 | 3 | 3 | 3 | 2 |
| summary | 3 | 18 | 21 | 15 | 18 | 13 | 10 |
| managers | 3 | 5 | 6 | 2 | 4 | 3 | 2 |