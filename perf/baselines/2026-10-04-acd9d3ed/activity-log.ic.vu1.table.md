### activity-log — ic, 3 iterations/VU, 1 VU

requests 17, failed rate 0.00 %, responses without Server-Timing 0

#### ic / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 9 | 10 | 10 |
| summed request ms | 25 | 33 | 34 |
| db ms | 15 | 17 | 17 |
| statements | 21 | 21 | 21 |
| transactions | 12 | 12 | 12 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 6 | 8 | 4 | 5 | 6 | 3 |
| shell-probe | 3 | 3 | 5 | 2 | 3 | 3 | 2 |
| shell-alerts | 3 | 3 | 4 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 6 | 2 | 3 | 3 | 2 |
| activity | 3 | 8 | 10 | 6 | 6 | 7 | 3 |