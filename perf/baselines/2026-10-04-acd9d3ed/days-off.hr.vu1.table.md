### days-off — hr, 3 iterations/VU, 1 VU

requests 77, failed rate 0.00 %, responses without Server-Timing 0

#### hr / calendar

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 4 | 5 | 5 |
| summed request ms | 15 | 15 | 15 |
| db ms | 10 | 10 | 10 |
| statements | 19 | 19 | 19 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 2 | 3 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| calendar | 3 | 3 | 4 | 2 | 3 | 6 | 2 |

#### hr / calendar-shared

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 2 | 2 | 2 |
| summed request ms | 2 | 2 | 2 |
| db ms | 1 | 1 | 1 |
| statements | 3 | 3 | 3 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 2 | 2 | 1 | 1 | 3 | 3 |

#### hr / calendar-org

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 13 | 15 | 15 |
| summed request ms | 16 | 19 | 19 |
| db ms | 13 | 16 | 16 |
| statements | 10 | 10 | 10 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 13 | 15 | 11 | 13 | 7 | 2 |
| teams-all | 3 | 2 | 4 | 2 | 3 | 3 | 2 |

#### hr / requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 3 | 3 | 3 |
| summed request ms | 8 | 8 | 9 |
| db ms | 5 | 6 | 6 |
| statements | 13 | 13 | 13 |
| transactions | 6 | 6 | 6 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 3 | 3 | 2 | 3 | 7 | 2 |
| entries | 3 | 2 | 3 | 2 | 2 | 4 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |

#### hr / drilldown-audit

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 14 | 14 | 14 |
| elapsed wall ms | 46 | 51 | 51 |
| summed request ms | 65 | 74 | 74 |
| db ms | 50 | 57 | 58 |
| statements | 76 | 76 | 76 |
| transactions | 29 | 29 | 29 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 2 | 3 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 1 | 1 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| users | 18 | 6 | 9 | 5 | 8 | 8 | 2 |
| budgets | 3 | 4 | 4 | 3 | 3 | 7 | 2 |
| entries | 3 | 3 | 7 | 2 | 6 | 4 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| corrections | 3 | 2 | 7 | 1 | 6 | 2 | 2 |