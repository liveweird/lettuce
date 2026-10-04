### activity-log — ceo, 3 iterations/VU, 1 VU

requests 50, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 17 | 22 | 23 |
| summed request ms | 32 | 37 | 38 |
| db ms | 24 | 30 | 30 |
| statements | 25 | 25 | 25 |
| transactions | 12 | 12 | 12 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 4 | 4 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 4 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 5 | 5 | 4 | 4 | 3 | 2 |
| activity | 3 | 16 | 22 | 15 | 20 | 11 | 3 |

#### ceo / report

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 91 | 102 | 103 |
| summed request ms | 112 | 121 | 123 |
| db ms | 99 | 107 | 108 |
| statements | 99 | 99 | 99 |
| transactions | 25 | 25 | 25 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 5 | 4 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 5 | 3 | 4 | 3 | 2 |
| users | 18 | 9 | 12 | 8 | 11 | 12 | 2 |
| activity | 3 | 41 | 46 | 39 | 45 | 13 | 4 |