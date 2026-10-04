### succession — lead, 3 iterations/VU, 1 VU

requests 19, failed rate 0.00 %, responses without Server-Timing 0

#### lead / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 6 | 6 | 6 |
| summed request ms | 20 | 22 | 22 |
| db ms | 15 | 15 | 15 |
| statements | 18 | 18 | 18 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 2 | 4 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 4 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 6 | 6 | 4 | 5 | 3 | 2 |
| own | 3 | 5 | 5 | 4 | 4 | 4 | 2 |

#### lead / team

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 3 | 3 |
| summed request ms | 3 | 3 | 3 |
| db ms | 2 | 2 | 2 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 3 | 3 | 2 | 2 | 4 | 2 |