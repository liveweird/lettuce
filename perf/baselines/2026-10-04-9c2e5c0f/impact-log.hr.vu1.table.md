### impact-log — hr, 3 iterations/VU, 1 VU

requests 35, failed rate 0.00 %, responses without Server-Timing 0

#### hr / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 3 | 6 | 6 |
| summed request ms | 11 | 21 | 22 |
| db ms | 6 | 12 | 13 |
| statements | 16 | 16 | 16 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 4 | 2 | 2 | 5 | 3 |
| shell-probe | 3 | 2 | 3 | 1 | 1 | 3 | 2 |
| shell-alerts | 3 | 2 | 4 | 1 | 3 | 2 | 2 |
| shell-bell | 3 | 2 | 5 | 1 | 3 | 3 | 2 |
| own | 3 | 2 | 5 | 1 | 2 | 3 | 2 |

#### hr / drilldown-audit

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 4 | 6 | 6 |
| summed request ms | 17 | 24 | 25 |
| db ms | 12 | 15 | 15 |
| statements | 24 | 24 | 24 |
| transactions | 13 | 13 | 13 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 5 | 2 | 3 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| users | 3 | 3 | 5 | 2 | 4 | 8 | 2 |
| list | 3 | 3 | 4 | 2 | 3 | 3 | 2 |