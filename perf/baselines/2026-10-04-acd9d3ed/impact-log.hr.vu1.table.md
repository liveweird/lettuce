### impact-log — hr, 3 iterations/VU, 1 VU

requests 50, failed rate 0.00 %, responses without Server-Timing 0

#### hr / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 4 | 5 | 5 |
| summed request ms | 15 | 17 | 17 |
| db ms | 9 | 11 | 11 |
| statements | 16 | 16 | 16 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 2 | 3 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| own | 3 | 3 | 4 | 2 | 3 | 3 | 2 |

#### hr / drilldown-audit

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 46 | 48 | 48 |
| summed request ms | 58 | 63 | 63 |
| db ms | 46 | 48 | 49 |
| statements | 64 | 64 | 64 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 4 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 3 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| users | 18 | 7 | 9 | 6 | 7 | 8 | 2 |
| list | 3 | 4 | 4 | 2 | 3 | 3 | 2 |