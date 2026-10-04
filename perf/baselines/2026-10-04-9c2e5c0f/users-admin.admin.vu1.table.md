### users-admin — admin, 3 iterations/VU, 1 VU

requests 73, failed rate 0.00 %, responses without Server-Timing 0

#### admin / users

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 4 | 5 | 5 |
| summed request ms | 12 | 17 | 18 |
| db ms | 8 | 11 | 11 |
| statements | 22 | 22 | 22 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 4 | 2 | 2 | 5 | 3 |
| shell-probe | 3 | 2 | 3 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 2 | 3 | 1 | 2 | 3 | 2 |
| users | 3 | 3 | 5 | 3 | 3 | 9 | 2 |

#### admin / users-filtered

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 3 | 3 |
| summed request ms | 2 | 3 | 3 |
| db ms | 2 | 2 | 2 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| users | 3 | 2 | 3 | 2 | 2 | 4 | 2 |

#### admin / users-deep

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 2 | 3 | 3 |
| summed request ms | 3 | 3 | 3 |
| db ms | 2 | 2 | 2 |
| statements | 9 | 9 | 9 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| users | 3 | 3 | 3 | 2 | 2 | 9 | 2 |

#### admin / teams

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 5 | 6 | 6 |
| summed request ms | 17 | 21 | 21 |
| db ms | 12 | 14 | 14 |
| statements | 21 | 21 | 21 |
| transactions | 13 | 13 | 13 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 3 | 3 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| teams | 3 | 4 | 4 | 3 | 3 | 4 | 2 |
| teams-all | 3 | 4 | 5 | 3 | 3 | 4 | 2 |

#### admin / org-chart

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 31 | 34 | 34 |
| summed request ms | 38 | 40 | 40 |
| db ms | 27 | 28 | 29 |
| statements | 71 | 71 | 71 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 3 | 2 | 2 | 5 | 3 |
| shell-probe | 3 | 2 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 2 | 3 | 1 | 2 | 3 | 2 |
| teams-all | 3 | 4 | 5 | 3 | 4 | 4 | 2 |
| users-all | 18 | 4 | 6 | 3 | 4 | 9 | 2 |