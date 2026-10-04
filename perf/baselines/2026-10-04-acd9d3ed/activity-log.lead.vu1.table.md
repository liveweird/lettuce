### activity-log — lead, 3 iterations/VU, 1 VU

requests 51, failed rate 0.00 %, responses without Server-Timing 0

#### lead / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 11 | 19 | 20 |
| summed request ms | 28 | 39 | 40 |
| db ms | 20 | 28 | 29 |
| statements | 23 | 23 | 23 |
| transactions | 12 | 12 | 12 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 6 | 3 | 4 | 6 | 3 |
| shell-probe | 3 | 4 | 5 | 3 | 3 | 3 | 2 |
| shell-alerts | 3 | 4 | 4 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 5 | 6 | 3 | 4 | 3 | 2 |
| activity | 3 | 11 | 19 | 9 | 15 | 9 | 3 |

#### lead / report

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 66 | 68 | 68 |
| summed request ms | 86 | 86 | 86 |
| db ms | 73 | 74 | 74 |
| statements | 83 | 83 | 83 |
| transactions | 25 | 25 | 25 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 6 | 6 | 4 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 5 | 5 | 4 | 4 | 3 | 2 |
| users | 18 | 7 | 10 | 6 | 8 | 10 | 2 |
| activity | 3 | 27 | 27 | 25 | 25 | 9 | 4 |