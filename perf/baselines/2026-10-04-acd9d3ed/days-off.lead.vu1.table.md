### days-off — lead, 3 iterations/VU, 1 VU

requests 80, failed rate 0.00 %, responses without Server-Timing 0

#### lead / calendar

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 6 | 6 | 6 |
| summed request ms | 16 | 19 | 20 |
| db ms | 11 | 13 | 13 |
| statements | 22 | 22 | 22 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 5 | 2 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 3 | 3 | 3 | 2 |
| calendar | 3 | 5 | 5 | 4 | 4 | 8 | 2 |

#### lead / calendar-shared

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 2 | 2 | 2 |
| summed request ms | 2 | 2 | 3 |
| db ms | 1 | 2 | 2 |
| statements | 3 | 3 | 3 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 2 | 2 | 1 | 2 | 3 | 3 |

#### lead / calendar-managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 4 | 4 |
| summed request ms | 2 | 4 | 4 |
| db ms | 2 | 3 | 3 |
| statements | 7 | 7 | 7 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 2 | 4 | 2 | 3 | 7 | 2 |

#### lead / requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 4 | 4 | 4 |
| summed request ms | 8 | 9 | 9 |
| db ms | 6 | 6 | 6 |
| statements | 14 | 14 | 14 |
| transactions | 6 | 6 | 6 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 3 | 4 | 3 | 3 | 7 | 2 |
| entries | 3 | 3 | 3 | 2 | 2 | 5 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |

#### lead / team-requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 4 | 5 | 5 |
| summed request ms | 5 | 5 | 5 |
| db ms | 4 | 4 | 4 |
| statements | 10 | 10 | 10 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| entries | 3 | 3 | 4 | 3 | 3 | 8 | 2 |
| pool-types | 3 | 1 | 2 | 1 | 1 | 2 | 2 |

#### lead / team-budgets

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 4 | 5 | 5 |
| summed request ms | 4 | 5 | 5 |
| db ms | 4 | 4 | 4 |
| statements | 10 | 10 | 10 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 4 | 5 | 4 | 4 | 10 | 3 |

#### lead / drilldown

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 13 | 13 | 13 |
| elapsed wall ms | 48 | 52 | 52 |
| summed request ms | 70 | 75 | 76 |
| db ms | 54 | 61 | 62 |
| statements | 94 | 94 | 94 |
| transactions | 28 | 28 | 28 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 2 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 4 | 3 | 3 | 3 | 2 |
| users | 18 | 7 | 10 | 6 | 8 | 10 | 2 |
| budgets | 3 | 7 | 9 | 6 | 7 | 11 | 3 |
| entries | 3 | 5 | 7 | 4 | 6 | 7 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |