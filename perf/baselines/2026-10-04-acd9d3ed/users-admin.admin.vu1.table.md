### users-admin — admin, 3 iterations/VU, 1 VU

requests 340, failed rate 0.00 %, responses without Server-Timing 0

#### admin / users

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 7 | 7 | 7 |
| summed request ms | 19 | 19 | 19 |
| db ms | 13 | 14 | 14 |
| statements | 22 | 22 | 22 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 4 | 2 | 2 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| users | 3 | 6 | 6 | 5 | 5 | 9 | 2 |

#### admin / users-filtered

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 7 | 7 |
| summed request ms | 3 | 7 | 7 |
| db ms | 2 | 6 | 7 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| users | 3 | 3 | 7 | 2 | 6 | 4 | 2 |

#### admin / users-deep

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 4 | 5 | 5 |
| summed request ms | 4 | 5 | 5 |
| db ms | 3 | 4 | 4 |
| statements | 9 | 9 | 9 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| users | 3 | 4 | 5 | 3 | 4 | 9 | 2 |

#### admin / teams

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 42 | 48 | 49 |
| summed request ms | 50 | 59 | 60 |
| db ms | 39 | 46 | 47 |
| statements | 70 | 70 | 70 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 2 | 3 | 5 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| teams | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| users-all | 18 | 6 | 8 | 5 | 7 | 9 | 2 |

#### admin / org-chart

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 95 | 95 | 95 |
| elapsed wall ms | 82 | 107 | 110 |
| summed request ms | 403 | 420 | 422 |
| db ms | 296 | 303 | 303 |
| statements | 558 | 558 | 558 |
| transactions | 275 | 275 | 275 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 3 | 5 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 4 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| teams-all | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| team | 252 | 4 | 6 | 3 | 4 | 6 | 3 |
| users-all | 18 | 11 | 17 | 10 | 15 | 9 | 2 |