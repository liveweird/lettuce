### one-on-ones — ceo, 3 iterations/VU, 1 VU

requests 50, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 6 | 8 | 8 |
| summed request ms | 24 | 31 | 32 |
| db ms | 12 | 12 | 12 |
| statements | 18 | 18 | 18 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 6 | 2 | 3 | 6 | 3 |
| shell-probe | 3 | 5 | 6 | 2 | 3 | 4 | 2 |
| shell-alerts | 3 | 5 | 6 | 1 | 4 | 2 | 2 |
| shell-bell | 3 | 5 | 7 | 2 | 3 | 3 | 2 |
| own | 3 | 5 | 6 | 1 | 2 | 3 | 2 |

#### ceo / managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 5 | 6 | 6 |
| summed request ms | 5 | 6 | 6 |
| db ms | 5 | 5 | 5 |
| statements | 6 | 6 | 6 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 5 | 6 | 5 | 5 | 6 | 2 |

#### ceo / managed-latest

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 47 | 48 | 48 |
| summed request ms | 47 | 48 | 48 |
| db ms | 46 | 47 | 47 |
| statements | 6 | 6 | 6 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 47 | 48 | 46 | 47 | 6 | 2 |

#### ceo / team

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 14 | 16 | 16 |
| summed request ms | 14 | 15 | 15 |
| db ms | 13 | 13 | 13 |
| statements | 7 | 7 | 7 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 14 | 15 | 13 | 13 | 7 | 2 |

#### ceo / team-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 33 | 34 | 34 |
| summed request ms | 33 | 33 | 33 |
| db ms | 32 | 32 | 33 |
| statements | 10 | 10 | 10 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 33 | 33 | 32 | 32 | 10 | 2 |

#### ceo / detail-chain

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 7 | 7 | 7 |
| elapsed wall ms | 18 | 19 | 19 |
| summed request ms | 30 | 31 | 31 |
| db ms | 22 | 24 | 24 |
| statements | 69 | 69 | 69 |
| transactions | 20 | 20 | 20 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 2 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 4 | 2 |
| shell-alerts | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| meeting | 3 | 6 | 7 | 5 | 6 | 15 | 3 |
| events | 3 | 5 | 5 | 4 | 4 | 16 | 4 |
| item-history | 3 | 5 | 8 | 4 | 7 | 23 | 4 |