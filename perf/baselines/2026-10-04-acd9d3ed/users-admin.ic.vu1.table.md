### users-admin — ic, 3 iterations/VU, 1 VU

requests 334, failed rate 0.00 %, responses without Server-Timing 0

#### ic / users

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 6 | 6 | 6 |
| summed request ms | 16 | 19 | 20 |
| db ms | 12 | 13 | 13 |
| statements | 23 | 23 | 23 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 4 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 2 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| users | 3 | 5 | 6 | 4 | 4 | 9 | 2 |

#### ic / teams

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 39 | 41 | 41 |
| summed request ms | 48 | 52 | 52 |
| db ms | 40 | 41 | 41 |
| statements | 71 | 71 | 71 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 2 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| teams | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| users-all | 18 | 6 | 8 | 5 | 6 | 9 | 2 |

#### ic / org-chart

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 95 | 95 | 95 |
| elapsed wall ms | 74 | 97 | 100 |
| summed request ms | 389 | 392 | 393 |
| db ms | 275 | 279 | 280 |
| statements | 559 | 559 | 559 |
| transactions | 275 | 275 | 275 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 4 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| teams-all | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| team | 252 | 3 | 6 | 2 | 4 | 6 | 3 |
| users-all | 18 | 10 | 12 | 9 | 10 | 9 | 2 |