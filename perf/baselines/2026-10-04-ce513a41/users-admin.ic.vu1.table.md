### users-admin — ic, 3 iterations/VU, 1 VU

requests 82, failed rate 0.00 %, responses without Server-Timing 0

#### ic / users

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 4 | 7 | 7 |
| summed request ms | 13 | 22 | 23 |
| db ms | 8 | 13 | 13 |
| statements | 23 | 23 | 23 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 4 | 2 | 2 | 6 | 3 |
| shell-probe | 3 | 2 | 4 | 1 | 3 | 3 | 2 |
| shell-alerts | 3 | 2 | 4 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 2 | 4 | 1 | 2 | 3 | 2 |
| users | 3 | 4 | 6 | 3 | 4 | 9 | 2 |

#### ic / teams

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 29 | 33 | 33 |
| summed request ms | 33 | 43 | 44 |
| db ms | 25 | 31 | 31 |
| statements | 72 | 72 | 72 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 5 | 3 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| teams | 3 | 3 | 4 | 2 | 3 | 4 | 2 |
| users-all | 18 | 3 | 5 | 3 | 4 | 9 | 2 |

#### ic / org-chart

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 25 | 29 | 29 |
| summed request ms | 38 | 43 | 43 |
| db ms | 28 | 31 | 31 |
| statements | 72 | 72 | 72 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 6 | 2 | 4 | 6 | 3 |
| shell-probe | 3 | 2 | 4 | 1 | 3 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| teams-all | 3 | 4 | 5 | 3 | 4 | 4 | 2 |
| users-all | 18 | 3 | 6 | 2 | 4 | 9 | 2 |