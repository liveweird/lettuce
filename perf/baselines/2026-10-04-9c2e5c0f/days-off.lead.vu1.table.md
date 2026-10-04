### days-off — lead, 3 iterations/VU, 1 VU

requests 65, failed rate 0.00 %, responses without Server-Timing 0

#### lead / calendar

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 6 | 7 | 7 |
| summed request ms | 18 | 22 | 23 |
| db ms | 11 | 12 | 12 |
| statements | 23 | 23 | 23 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 2 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 3 | 3 | 4 | 2 |
| shell-alerts | 3 | 2 | 4 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| calendar | 3 | 4 | 6 | 3 | 4 | 8 | 2 |

#### lead / calendar-shared

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 2 | 3 | 3 |
| summed request ms | 2 | 2 | 2 |
| db ms | 1 | 1 | 1 |
| statements | 3 | 3 | 3 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 2 | 2 | 1 | 1 | 3 | 3 |

#### lead / calendar-managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 2 | 3 | 3 |
| summed request ms | 3 | 3 | 3 |
| db ms | 1 | 2 | 2 |
| statements | 7 | 7 | 7 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 3 | 3 | 1 | 2 | 7 | 2 |

#### lead / requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 3 | 5 | 5 |
| summed request ms | 7 | 9 | 10 |
| db ms | 5 | 6 | 6 |
| statements | 14 | 14 | 14 |
| transactions | 6 | 6 | 6 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 3 | 4 | 2 | 2 | 7 | 2 |
| entries | 3 | 3 | 4 | 2 | 3 | 5 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |

#### lead / team-requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 3 | 4 | 4 |
| summed request ms | 4 | 5 | 5 |
| db ms | 3 | 4 | 4 |
| statements | 10 | 10 | 10 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| entries | 3 | 3 | 4 | 2 | 3 | 8 | 2 |
| pool-types | 3 | 1 | 2 | 1 | 1 | 2 | 2 |

#### lead / team-budgets

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 3 | 3 |
| summed request ms | 3 | 3 | 3 |
| db ms | 2 | 2 | 2 |
| statements | 10 | 10 | 10 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 3 | 3 | 2 | 2 | 10 | 3 |

#### lead / drilldown

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 8 | 8 | 8 |
| elapsed wall ms | 6 | 8 | 8 |
| summed request ms | 28 | 29 | 29 |
| db ms | 20 | 20 | 20 |
| statements | 45 | 45 | 45 |
| transactions | 18 | 18 | 18 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 4 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| users | 3 | 4 | 4 | 3 | 3 | 10 | 2 |
| budgets | 3 | 5 | 6 | 4 | 4 | 11 | 3 |
| entries | 3 | 4 | 4 | 3 | 3 | 7 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |