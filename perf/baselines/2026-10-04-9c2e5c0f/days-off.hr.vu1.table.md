### days-off — hr, 3 iterations/VU, 1 VU

requests 62, failed rate 0.00 %, responses without Server-Timing 0

#### hr / calendar

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 3 | 6 | 6 |
| summed request ms | 12 | 19 | 20 |
| db ms | 7 | 10 | 10 |
| statements | 19 | 19 | 19 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 4 | 2 | 2 | 5 | 3 |
| shell-probe | 3 | 2 | 4 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 2 | 4 | 1 | 2 | 3 | 2 |
| calendar | 3 | 3 | 5 | 2 | 3 | 6 | 2 |

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
| elapsed wall ms | 8 | 11 | 11 |
| summed request ms | 12 | 14 | 14 |
| db ms | 9 | 12 | 12 |
| statements | 11 | 11 | 11 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 9 | 10 | 7 | 9 | 7 | 2 |
| teams-all | 3 | 3 | 4 | 2 | 3 | 4 | 2 |

#### hr / requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 4 | 5 | 5 |
| summed request ms | 7 | 9 | 9 |
| db ms | 5 | 6 | 6 |
| statements | 13 | 13 | 13 |
| transactions | 6 | 6 | 6 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 3 | 4 | 3 | 3 | 7 | 2 |
| entries | 3 | 2 | 3 | 2 | 2 | 4 | 2 |
| pool-types | 3 | 2 | 3 | 1 | 2 | 2 | 2 |

#### hr / drilldown-audit

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 9 | 9 | 9 |
| elapsed wall ms | 6 | 11 | 11 |
| summed request ms | 25 | 51 | 54 |
| db ms | 16 | 28 | 30 |
| statements | 36 | 36 | 36 |
| transactions | 19 | 19 | 19 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 7 | 2 | 6 | 5 | 3 |
| shell-probe | 3 | 3 | 6 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 6 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 7 | 2 | 5 | 3 | 2 |
| users | 3 | 4 | 9 | 3 | 8 | 8 | 2 |
| budgets | 3 | 4 | 8 | 3 | 3 | 7 | 2 |
| entries | 3 | 3 | 3 | 2 | 2 | 4 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| corrections | 3 | 2 | 3 | 1 | 1 | 2 | 2 |