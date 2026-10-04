### succession — ceo, 3 iterations/VU, 1 VU

requests 23, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 5 | 7 | 7 |
| summed request ms | 19 | 22 | 23 |
| db ms | 13 | 16 | 16 |
| statements | 18 | 18 | 18 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 6 | 4 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 4 | 5 | 3 | 4 | 3 | 2 |
| own | 3 | 5 | 5 | 3 | 4 | 4 | 2 |

#### ceo / team

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 3 | 3 |
| summed request ms | 3 | 4 | 4 |
| db ms | 3 | 3 | 3 |
| statements | 5 | 5 | 5 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 3 | 4 | 3 | 3 | 5 | 2 |

#### ceo / team-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 8 | 9 | 9 |
| summed request ms | 8 | 9 | 9 |
| db ms | 7 | 8 | 8 |
| statements | 8 | 8 | 8 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 8 | 9 | 7 | 8 | 8 | 2 |