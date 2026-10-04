### one-on-ones — lead, 3 iterations/VU, 1 VU

requests 44, failed rate 0.00 %, responses without Server-Timing 0

#### lead / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 5 | 7 | 7 |
| summed request ms | 17 | 20 | 21 |
| db ms | 11 | 12 | 12 |
| statements | 21 | 21 | 21 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 2 | 4 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 4 | 2 | 2 | 3 | 2 |
| own | 3 | 4 | 5 | 3 | 4 | 6 | 2 |

#### lead / managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 5 | 5 | 5 |
| summed request ms | 4 | 6 | 6 |
| db ms | 4 | 5 | 5 |
| statements | 6 | 6 | 6 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 4 | 6 | 4 | 5 | 6 | 2 |

#### lead / managed-latest

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 4 | 5 | 5 |
| summed request ms | 4 | 4 | 4 |
| db ms | 3 | 3 | 3 |
| statements | 6 | 6 | 6 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 4 | 4 | 3 | 3 | 6 | 2 |

#### lead / team

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 2 | 2 | 2 |
| summed request ms | 2 | 2 | 2 |
| db ms | 1 | 2 | 2 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 2 | 2 | 1 | 2 | 4 | 2 |

#### lead / drilldown

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 7 | 9 | 9 |
| summed request ms | 28 | 40 | 41 |
| db ms | 19 | 33 | 35 |
| statements | 31 | 31 | 31 |
| transactions | 13 | 13 | 13 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 7 | 3 | 6 | 6 | 3 |
| shell-probe | 3 | 4 | 6 | 2 | 5 | 4 | 2 |
| shell-alerts | 3 | 2 | 5 | 1 | 4 | 2 | 2 |
| shell-bell | 3 | 5 | 6 | 3 | 5 | 3 | 2 |
| users | 3 | 5 | 7 | 4 | 6 | 10 | 2 |
| list | 3 | 7 | 8 | 5 | 7 | 6 | 2 |