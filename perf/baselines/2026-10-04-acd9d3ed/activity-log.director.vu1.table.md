### activity-log — director, 3 iterations/VU, 1 VU

requests 51, failed rate 0.00 %, responses without Server-Timing 0

#### director / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 13 | 18 | 18 |
| summed request ms | 24 | 35 | 37 |
| db ms | 18 | 26 | 27 |
| statements | 24 | 24 | 24 |
| transactions | 12 | 12 | 12 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 6 | 4 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| shell-alerts | 3 | 2 | 5 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 4 | 5 | 3 | 4 | 3 | 2 |
| activity | 3 | 10 | 16 | 9 | 13 | 10 | 3 |

#### director / report

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 69 | 74 | 74 |
| summed request ms | 86 | 93 | 93 |
| db ms | 74 | 80 | 81 |
| statements | 91 | 91 | 91 |
| transactions | 25 | 25 | 25 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 5 | 4 | 4 | 6 | 3 |
| shell-probe | 3 | 2 | 3 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 4 | 4 | 3 | 4 | 3 | 2 |
| users | 18 | 8 | 10 | 7 | 8 | 11 | 2 |
| activity | 3 | 28 | 29 | 26 | 27 | 11 | 4 |