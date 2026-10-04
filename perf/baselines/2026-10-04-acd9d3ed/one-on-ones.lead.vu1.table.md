### one-on-ones — lead, 3 iterations/VU, 1 VU

requests 59, failed rate 0.00 %, responses without Server-Timing 0

#### lead / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 6 | 7 | 7 |
| summed request ms | 21 | 23 | 23 |
| db ms | 16 | 16 | 16 |
| statements | 20 | 20 | 20 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 5 | 4 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 5 | 5 | 4 | 4 | 3 | 2 |
| own | 3 | 6 | 6 | 5 | 5 | 6 | 2 |

#### lead / managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 6 | 7 | 7 |
| summed request ms | 6 | 6 | 6 |
| db ms | 6 | 6 | 6 |
| statements | 12 | 12 | 12 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 6 | 6 | 6 | 6 | 12 | 2 |

#### lead / managed-latest

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 37 | 37 | 37 |
| summed request ms | 36 | 37 | 37 |
| db ms | 36 | 36 | 36 |
| statements | 12 | 12 | 12 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 36 | 37 | 36 | 36 | 12 | 2 |

#### lead / team

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 2 | 2 | 2 |
| summed request ms | 2 | 3 | 3 |
| db ms | 1 | 2 | 2 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 2 | 3 | 1 | 2 | 4 | 2 |

#### lead / drilldown

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 54 | 67 | 68 |
| summed request ms | 74 | 81 | 82 |
| db ms | 60 | 63 | 63 |
| statements | 80 | 80 | 80 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 5 | 3 | 3 | 3 | 2 |
| users | 18 | 8 | 14 | 7 | 10 | 10 | 2 |
| list | 3 | 8 | 10 | 6 | 8 | 6 | 2 |