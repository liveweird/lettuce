### dashboard — ceo, 3 iterations/VU, 1 VU

requests 46, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / first-load

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 20 | 25 | 26 |
| summed request ms | 34 | 43 | 44 |
| db ms | 28 | 33 | 34 |
| statements | 33 | 33 | 33 |
| transactions | 21 | 21 | 21 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 5 | 3 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 3 | 4 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| summary | 3 | 19 | 25 | 18 | 21 | 15 | 10 |
| managers | 3 | 3 | 4 | 2 | 3 | 3 | 2 |

#### ceo / peers-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 3 | 4 | 4 |
| summed request ms | 4 | 6 | 6 |
| db ms | 3 | 4 | 4 |
| statements | 7 | 7 | 7 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 4 | 2 | 3 | 4 | 2 |
| members-member | 3 | 2 | 2 | 1 | 1 | 3 | 2 |

#### ceo / subordinates-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 12 | 15 | 15 |
| summed request ms | 17 | 22 | 23 |
| db ms | 13 | 18 | 19 |
| statements | 29 | 29 | 29 |
| transactions | 15 | 15 | 15 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 4 | 6 | 3 | 5 | 4 | 2 |
| members-managed | 3 | 11 | 14 | 9 | 12 | 21 | 11 |
| succession-own | 3 | 3 | 3 | 2 | 2 | 4 | 2 |

#### ceo / subordinates-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 13 | 15 | 15 |
| summed request ms | 20 | 21 | 21 |
| db ms | 17 | 17 | 17 |
| statements | 33 | 33 | 33 |
| transactions | 15 | 15 | 15 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 4 | 2 | 3 | 4 | 2 |
| members-managed | 3 | 13 | 14 | 12 | 13 | 25 | 11 |
| succession-own | 3 | 3 | 3 | 2 | 2 | 4 | 2 |

#### ceo / my-teams-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 1 | 2 | 2 |
| summed request ms | 1 | 1 | 1 |
| db ms | 1 | 1 | 1 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-managed | 3 | 1 | 1 | 1 | 1 | 4 | 2 |