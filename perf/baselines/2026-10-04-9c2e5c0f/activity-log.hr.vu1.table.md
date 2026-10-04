### activity-log — hr, 3 iterations/VU, 1 VU

requests 36, failed rate 0.00 %, responses without Server-Timing 0

#### hr / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 5 | 7 | 7 |
| summed request ms | 16 | 20 | 21 |
| db ms | 10 | 11 | 12 |
| statements | 20 | 20 | 20 |
| transactions | 12 | 12 | 12 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 5 | 2 | 3 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| activity | 3 | 5 | 6 | 3 | 4 | 7 | 3 |

#### hr / audit

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 11 | 11 | 11 |
| summed request ms | 26 | 26 | 26 |
| db ms | 18 | 19 | 19 |
| statements | 29 | 29 | 29 |
| transactions | 14 | 14 | 14 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 2 | 3 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| users | 3 | 4 | 5 | 3 | 4 | 8 | 2 |
| activity | 3 | 10 | 10 | 8 | 8 | 8 | 3 |