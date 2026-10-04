### dashboard — ic, 3 iterations/VU, 1 VU

requests 25, failed rate 0.00 %, responses without Server-Timing 0

#### ic / first-load

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 22 | 25 | 25 |
| summed request ms | 45 | 59 | 61 |
| db ms | 33 | 48 | 49 |
| statements | 42 | 42 | 42 |
| transactions | 27 | 27 | 27 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 10 | 4 | 9 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 4 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 5 | 5 | 3 | 3 | 3 | 2 |
| summary | 3 | 22 | 24 | 19 | 21 | 17 | 11 |
| managers | 3 | 9 | 15 | 7 | 11 | 11 | 7 |

#### ic / peers-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 9 | 9 | 9 |
| summed request ms | 12 | 12 | 12 |
| db ms | 9 | 9 | 9 |
| statements | 16 | 16 | 16 |
| transactions | 10 | 10 | 10 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| members-member | 3 | 9 | 9 | 7 | 7 | 13 | 8 |