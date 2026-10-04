### users-admin — admin, 3 iterations/VU, 1 VU

requests 88, failed rate 0.00 %, responses without Server-Timing 0

#### admin / users

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 4 | 7 | 7 |
| summed request ms | 13 | 19 | 20 |
| db ms | 9 | 10 | 11 |
| statements | 22 | 22 | 22 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 4 | 2 | 2 | 5 | 3 |
| shell-probe | 3 | 2 | 3 | 1 | 1 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 2 | 3 | 1 | 2 | 3 | 2 |
| users | 3 | 4 | 6 | 3 | 4 | 9 | 2 |

#### admin / users-filtered

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 5 | 5 |
| summed request ms | 3 | 4 | 5 |
| db ms | 2 | 2 | 2 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| users | 3 | 3 | 4 | 2 | 2 | 4 | 2 |

#### admin / users-deep

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 4 | 4 |
| summed request ms | 3 | 4 | 4 |
| db ms | 2 | 3 | 3 |
| statements | 9 | 9 | 9 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| users | 3 | 3 | 4 | 2 | 3 | 9 | 2 |

#### admin / teams

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 27 | 28 | 28 |
| summed request ms | 35 | 38 | 38 |
| db ms | 25 | 25 | 26 |
| statements | 71 | 71 | 71 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 3 | 3 | 5 | 3 |
| shell-probe | 3 | 2 | 3 | 1 | 1 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 2 | 4 | 1 | 2 | 3 | 2 |
| teams | 3 | 3 | 3 | 2 | 2 | 4 | 2 |
| users-all | 18 | 3 | 6 | 3 | 4 | 9 | 2 |

#### admin / org-chart

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 25 | 25 | 25 |
| summed request ms | 34 | 41 | 42 |
| db ms | 24 | 28 | 29 |
| statements | 71 | 71 | 71 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 4 | 2 | 3 | 5 | 3 |
| shell-probe | 3 | 2 | 4 | 1 | 1 | 3 | 2 |
| shell-alerts | 3 | 2 | 4 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 2 | 4 | 1 | 3 | 3 | 2 |
| teams-all | 3 | 3 | 5 | 2 | 4 | 4 | 2 |
| users-all | 18 | 3 | 5 | 3 | 4 | 9 | 2 |