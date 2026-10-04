### dashboard — admin, 3 iterations/VU, 1 VU

requests 19, failed rate 0.00 %, responses without Server-Timing 0

#### admin / first-load

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 19 | 20 | 20 |
| summed request ms | 36 | 37 | 37 |
| db ms | 28 | 29 | 29 |
| statements | 29 | 29 | 29 |
| transactions | 21 | 21 | 21 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 3 | 5 | 3 |
| shell-probe | 3 | 4 | 4 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| summary | 3 | 18 | 20 | 15 | 17 | 13 | 10 |
| managers | 3 | 4 | 4 | 2 | 3 | 3 | 2 |