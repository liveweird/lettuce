### one-on-ones — ceo, 3 iterations/VU, 1 VU

requests 50, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 5 | 9 | 9 |
| summed request ms | 15 | 20 | 21 |
| db ms | 9 | 12 | 12 |
| statements | 18 | 18 | 18 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 2 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 1 | 3 | 4 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 5 | 2 | 3 | 3 | 2 |
| own | 3 | 3 | 5 | 2 | 3 | 3 | 2 |

#### ceo / managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 5 | 8 | 8 |
| summed request ms | 5 | 7 | 7 |
| db ms | 4 | 5 | 5 |
| statements | 6 | 6 | 6 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 5 | 7 | 4 | 5 | 6 | 2 |

#### ceo / managed-latest

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 5 | 5 |
| summed request ms | 3 | 5 | 6 |
| db ms | 3 | 3 | 3 |
| statements | 6 | 6 | 6 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 3 | 5 | 3 | 3 | 6 | 2 |

#### ceo / team

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 13 | 14 | 14 |
| summed request ms | 13 | 13 | 13 |
| db ms | 12 | 13 | 13 |
| statements | 7 | 7 | 7 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 13 | 13 | 12 | 13 | 7 | 2 |

#### ceo / team-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 33 | 34 | 34 |
| summed request ms | 34 | 34 | 34 |
| db ms | 33 | 33 | 33 |
| statements | 10 | 10 | 10 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 34 | 34 | 33 | 33 | 10 | 2 |

#### ceo / detail-chain

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 7 | 7 | 7 |
| elapsed wall ms | 16 | 19 | 19 |
| summed request ms | 28 | 28 | 28 |
| db ms | 19 | 20 | 20 |
| statements | 69 | 69 | 69 |
| transactions | 20 | 20 | 20 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 4 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| meeting | 3 | 6 | 6 | 4 | 5 | 15 | 3 |
| events | 3 | 4 | 5 | 3 | 3 | 16 | 4 |
| item-history | 3 | 4 | 5 | 3 | 4 | 23 | 4 |