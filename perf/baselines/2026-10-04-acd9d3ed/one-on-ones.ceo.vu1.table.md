### one-on-ones — ceo, 3 iterations/VU, 1 VU

requests 50, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 5 | 6 | 6 |
| summed request ms | 17 | 21 | 22 |
| db ms | 11 | 14 | 14 |
| statements | 17 | 17 | 17 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 4 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 4 | 5 | 3 | 3 | 3 | 2 |
| own | 3 | 3 | 4 | 2 | 3 | 3 | 2 |

#### ceo / managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 8 | 8 | 8 |
| summed request ms | 8 | 8 | 8 |
| db ms | 7 | 7 | 7 |
| statements | 15 | 15 | 15 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 8 | 8 | 7 | 7 | 15 | 2 |

#### ceo / managed-latest

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 49 | 50 | 50 |
| summed request ms | 49 | 49 | 49 |
| db ms | 48 | 48 | 48 |
| statements | 15 | 15 | 15 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 49 | 49 | 48 | 48 | 15 | 2 |

#### ceo / team

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 18 | 18 | 18 |
| summed request ms | 18 | 18 | 18 |
| db ms | 17 | 17 | 17 |
| statements | 26 | 26 | 26 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 18 | 18 | 17 | 17 | 26 | 2 |

#### ceo / team-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 40 | 45 | 45 |
| summed request ms | 40 | 45 | 45 |
| db ms | 40 | 44 | 44 |
| statements | 29 | 29 | 29 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 40 | 45 | 40 | 44 | 29 | 2 |

#### ceo / detail-chain

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 7 | 7 | 7 |
| elapsed wall ms | 23 | 24 | 24 |
| summed request ms | 36 | 39 | 39 |
| db ms | 29 | 30 | 31 |
| statements | 68 | 68 | 68 |
| transactions | 20 | 20 | 20 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 5 | 4 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 4 | 5 | 3 | 3 | 3 | 2 |
| meeting | 3 | 8 | 8 | 7 | 7 | 15 | 3 |
| events | 3 | 6 | 6 | 5 | 5 | 16 | 4 |
| item-history | 3 | 9 | 9 | 7 | 8 | 23 | 4 |