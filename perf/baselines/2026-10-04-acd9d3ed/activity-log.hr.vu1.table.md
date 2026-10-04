### activity-log — hr, 3 iterations/VU, 1 VU

requests 51, failed rate 0.00 %, responses without Server-Timing 0

#### hr / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 7 | 9 | 9 |
| summed request ms | 18 | 21 | 21 |
| db ms | 11 | 14 | 14 |
| statements | 20 | 20 | 20 |
| transactions | 12 | 12 | 12 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 4 | 2 | 3 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| activity | 3 | 7 | 8 | 5 | 6 | 7 | 3 |

#### hr / audit

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 46 | 48 | 48 |
| summed request ms | 66 | 67 | 67 |
| db ms | 53 | 54 | 54 |
| statements | 67 | 67 | 67 |
| transactions | 24 | 24 | 24 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 7 | 3 | 5 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 1 | 1 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 2 | 3 | 2 | 2 | 3 | 2 |
| users | 18 | 6 | 12 | 5 | 10 | 8 | 2 |
| activity | 3 | 13 | 14 | 12 | 12 | 6 | 3 |