### days-off — ceo, 3 iterations/VU, 1 VU

requests 53, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / calendar

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 6 | 6 | 6 |
| summed request ms | 19 | 24 | 25 |
| db ms | 12 | 15 | 15 |
| statements | 20 | 20 | 20 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 6 | 4 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 5 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 5 | 5 | 3 | 4 | 3 | 2 |
| calendar | 3 | 5 | 5 | 4 | 4 | 6 | 2 |

#### ceo / calendar-shared

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 2 | 3 | 3 |
| summed request ms | 2 | 3 | 3 |
| db ms | 2 | 2 | 2 |
| statements | 3 | 3 | 3 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 2 | 3 | 2 | 2 | 3 | 3 |

#### ceo / calendar-managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 4 | 4 | 4 |
| summed request ms | 3 | 3 | 3 |
| db ms | 3 | 3 | 3 |
| statements | 7 | 7 | 7 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 3 | 3 | 3 | 3 | 7 | 2 |

#### ceo / calendar-managed-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 16 | 18 | 18 |
| summed request ms | 16 | 18 | 18 |
| db ms | 14 | 15 | 15 |
| statements | 10 | 10 | 10 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| calendar | 3 | 16 | 18 | 14 | 15 | 10 | 2 |

#### ceo / requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 7 | 7 | 7 |
| summed request ms | 13 | 14 | 14 |
| db ms | 10 | 11 | 11 |
| statements | 16 | 16 | 16 |
| transactions | 6 | 6 | 6 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 5 | 5 | 3 | 4 | 7 | 2 |
| entries | 3 | 7 | 7 | 6 | 6 | 7 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |

#### ceo / team-requests

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 6 | 7 | 7 |
| summed request ms | 8 | 9 | 9 |
| db ms | 7 | 7 | 7 |
| statements | 12 | 12 | 12 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| entries | 3 | 6 | 7 | 5 | 6 | 10 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |

#### ceo / team-requests-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 11 | 11 | 11 |
| summed request ms | 12 | 13 | 13 |
| db ms | 11 | 11 | 11 |
| statements | 11 | 11 | 11 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| entries | 3 | 10 | 11 | 10 | 10 | 9 | 2 |
| pool-types | 3 | 2 | 2 | 1 | 1 | 2 | 2 |

#### ceo / team-budgets

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 6 | 7 | 7 |
| summed request ms | 6 | 6 | 6 |
| db ms | 5 | 5 | 5 |
| statements | 10 | 10 | 10 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 6 | 6 | 5 | 5 | 10 | 3 |

#### ceo / team-budgets-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 69 | 71 | 71 |
| summed request ms | 69 | 71 | 71 |
| db ms | 67 | 68 | 68 |
| statements | 13 | 13 | 13 |
| transactions | 3 | 3 | 3 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| budgets | 3 | 69 | 71 | 67 | 68 | 13 | 3 |