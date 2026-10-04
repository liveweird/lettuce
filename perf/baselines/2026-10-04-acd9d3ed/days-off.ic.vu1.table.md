### days-off — ic, 3 iterations/VU, 1 VU

requests 28, failed rate 0.00 %, responses without Server-Timing 0

#### ic / calendar

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 5 | 5 | 5 |
| summed request ms | 16 | 19 | 20 |
| db ms | 11 | 13 | 13 |
| statements | 22 | 22 | 22 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| calendar | 3 | 4 | 5 | 3 | 4 | 8 | 2 |

#### ic / calendar-shared

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

#### ic / requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 3 | 3 | 3 |
| summed request ms | 8 | 8 | 8 |
| db ms | 6 | 6 | 6 |
| statements | 13 | 13 | 13 |
| transactions | 6 | 6 | 6 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 3 | 3 | 3 | 3 | 7 | 2 |
| entries | 3 | 3 | 3 | 2 | 2 | 4 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |