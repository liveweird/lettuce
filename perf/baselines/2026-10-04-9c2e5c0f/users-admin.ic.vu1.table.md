### users-admin — ic, 3 iterations/VU, 1 VU

requests 67, failed rate 0.00 %, responses without Server-Timing 0

#### ic / users

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 5 | 6 | 6 |
| summed request ms | 14 | 19 | 19 |
| db ms | 10 | 12 | 12 |
| statements | 23 | 23 | 23 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 5 | 2 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 2 | 4 | 2 | 3 | 3 | 2 |
| users | 3 | 4 | 4 | 3 | 3 | 9 | 2 |

#### ic / teams

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 6 | 9 | 9 |
| summed request ms | 22 | 35 | 36 |
| db ms | 16 | 24 | 25 |
| statements | 22 | 22 | 22 |
| transactions | 13 | 13 | 13 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 8 | 2 | 6 | 6 | 3 |
| shell-probe | 3 | 2 | 2 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 5 | 7 | 4 | 4 | 3 | 2 |
| teams | 3 | 5 | 8 | 4 | 7 | 4 | 2 |
| teams-all | 3 | 5 | 7 | 4 | 7 | 4 | 2 |

#### ic / org-chart

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 28 | 29 | 29 |
| summed request ms | 37 | 47 | 48 |
| db ms | 26 | 29 | 30 |
| statements | 72 | 72 | 72 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 7 | 3 | 4 | 6 | 3 |
| shell-probe | 3 | 2 | 3 | 1 | 1 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 5 | 2 | 2 | 3 | 2 |
| teams-all | 3 | 3 | 7 | 3 | 4 | 4 | 2 |
| users-all | 18 | 3 | 5 | 3 | 4 | 9 | 2 |