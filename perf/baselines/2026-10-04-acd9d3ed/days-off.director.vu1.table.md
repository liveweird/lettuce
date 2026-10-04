### days-off — director, 3 iterations/VU, 1 VU

requests 53, failed rate 0.00 %, responses without Server-Timing 0

#### director / calendar

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 4 | 6 | 6 |
| summed request ms | 15 | 18 | 18 |
| db ms | 11 | 12 | 12 |
| statements | 22 | 22 | 22 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 2 | 3 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 4 | 3 | 3 | 3 | 2 |
| calendar | 3 | 4 | 5 | 3 | 4 | 8 | 2 |

#### director / calendar-shared

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 3 | 3 |
| summed request ms | 3 | 3 | 3 |
| db ms | 1 | 1 | 2 |
| statements | 3 | 3 | 3 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 3 | 3 | 1 | 1 | 3 | 3 |

#### director / calendar-managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 3 | 3 |
| summed request ms | 3 | 3 | 3 |
| db ms | 2 | 2 | 2 |
| statements | 7 | 7 | 7 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 3 | 3 | 2 | 2 | 7 | 2 |

#### director / calendar-managed-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 5 | 5 | 5 |
| summed request ms | 5 | 5 | 5 |
| db ms | 4 | 4 | 4 |
| statements | 9 | 9 | 9 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 5 | 5 | 4 | 4 | 9 | 2 |

#### director / requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 4 | 4 | 4 |
| summed request ms | 9 | 9 | 9 |
| db ms | 7 | 7 | 7 |
| statements | 15 | 15 | 15 |
| transactions | 6 | 6 | 6 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 3 | 3 | 2 | 3 | 7 | 2 |
| entries | 3 | 4 | 4 | 3 | 3 | 6 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |

#### director / team-requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 5 | 5 | 5 |
| summed request ms | 6 | 7 | 7 |
| db ms | 5 | 5 | 5 |
| statements | 11 | 11 | 11 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| entries | 3 | 4 | 5 | 4 | 4 | 9 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |

#### director / team-requests-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 4 | 5 | 5 |
| summed request ms | 6 | 7 | 7 |
| db ms | 5 | 5 | 5 |
| statements | 10 | 10 | 10 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| entries | 3 | 5 | 5 | 4 | 4 | 8 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |

#### director / team-budgets

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 5 | 5 | 5 |
| summed request ms | 5 | 5 | 5 |
| db ms | 4 | 4 | 4 |
| statements | 10 | 10 | 10 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 5 | 5 | 4 | 4 | 10 | 3 |

#### director / team-budgets-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 11 | 12 | 12 |
| summed request ms | 11 | 12 | 12 |
| db ms | 10 | 11 | 11 |
| statements | 12 | 12 | 12 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 11 | 12 | 10 | 11 | 12 | 3 |