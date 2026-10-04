### dashboard — ceo, 3 iterations/VU, 1 VU

requests 46, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / first-load

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 19 | 23 | 23 |
| summed request ms | 36 | 41 | 41 |
| db ms | 24 | 26 | 26 |
| statements | 33 | 33 | 33 |
| transactions | 21 | 21 | 21 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 6 | 2 | 2 | 6 | 3 |
| shell-probe | 3 | 4 | 5 | 2 | 3 | 4 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 4 | 6 | 3 | 3 | 3 | 2 |
| summary | 3 | 17 | 18 | 14 | 16 | 15 | 10 |
| managers | 3 | 4 | 4 | 2 | 2 | 3 | 2 |

#### ceo / peers-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 3 | 4 | 4 |
| summed request ms | 6 | 7 | 7 |
| db ms | 3 | 3 | 3 |
| statements | 7 | 7 | 7 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 4 | 2 | 2 | 4 | 2 |
| members-member | 3 | 3 | 3 | 1 | 2 | 3 | 2 |

#### ceo / subordinates-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 10 | 10 | 10 |
| summed request ms | 15 | 17 | 17 |
| db ms | 11 | 13 | 13 |
| statements | 29 | 29 | 29 |
| transactions | 15 | 15 | 15 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 4 | 2 | 3 | 4 | 2 |
| members-managed | 3 | 9 | 9 | 7 | 7 | 21 | 11 |
| succession-own | 3 | 2 | 4 | 2 | 3 | 4 | 2 |

#### ceo / subordinates-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 14 | 17 | 17 |
| summed request ms | 18 | 19 | 19 |
| db ms | 15 | 15 | 15 |
| statements | 33 | 33 | 33 |
| transactions | 15 | 15 | 15 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 4 | 2 | 3 | 4 | 2 |
| members-managed | 3 | 11 | 13 | 10 | 11 | 25 | 11 |
| succession-own | 3 | 3 | 3 | 2 | 2 | 4 | 2 |

#### ceo / my-teams-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 1 | 2 | 2 |
| summed request ms | 1 | 2 | 2 |
| db ms | 1 | 1 | 1 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-managed | 3 | 1 | 2 | 1 | 1 | 4 | 2 |