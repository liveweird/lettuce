### team-kpis — ceo, 3 iterations/VU, 1 VU

requests 55, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 7 | 12 | 13 |
| summed request ms | 29 | 32 | 33 |
| db ms | 21 | 22 | 22 |
| statements | 24 | 24 | 24 |
| transactions | 13 | 13 | 13 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 4 | 5 | 2 | 4 | 3 | 2 |
| shell-alerts | 3 | 4 | 4 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 6 | 3 | 4 | 3 | 2 |
| list | 3 | 6 | 11 | 6 | 10 | 7 | 2 |
| teams-all | 3 | 4 | 5 | 2 | 3 | 3 | 2 |

#### ceo / managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 6 | 7 | 7 |
| summed request ms | 8 | 10 | 11 |
| db ms | 6 | 8 | 8 |
| statements | 10 | 10 | 10 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| list | 3 | 5 | 6 | 5 | 5 | 7 | 2 |
| teams-all | 3 | 2 | 4 | 2 | 2 | 3 | 2 |

#### ceo / managed-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 9 | 9 | 9 |
| summed request ms | 12 | 16 | 16 |
| db ms | 10 | 13 | 13 |
| statements | 10 | 10 | 10 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| list | 3 | 8 | 8 | 7 | 8 | 7 | 2 |
| teams-all | 3 | 4 | 8 | 3 | 5 | 3 | 2 |

#### ceo / detail

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 8 | 8 | 8 |
| elapsed wall ms | 20 | 21 | 21 |
| summed request ms | 30 | 32 | 33 |
| db ms | 21 | 22 | 23 |
| statements | 29 | 29 | 29 |
| transactions | 19 | 19 | 19 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 2 | 4 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 4 | 3 | 3 | 3 | 2 |
| list | 3 | 5 | 6 | 4 | 5 | 7 | 2 |
| kpi | 3 | 3 | 3 | 2 | 2 | 2 | 2 |
| values | 3 | 3 | 4 | 2 | 2 | 3 | 3 |
| events | 3 | 7 | 7 | 5 | 5 | 3 | 3 |