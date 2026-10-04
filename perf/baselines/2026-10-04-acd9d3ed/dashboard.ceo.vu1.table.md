### dashboard — ceo, 3 iterations/VU, 1 VU

requests 46, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / first-load

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 28 | 42 | 43 |
| summed request ms | 49 | 60 | 62 |
| db ms | 37 | 51 | 52 |
| statements | 32 | 32 | 32 |
| transactions | 21 | 21 | 21 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 5 | 3 | 3 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 4 | 4 | 3 | 3 | 3 | 2 |
| summary | 3 | 27 | 41 | 24 | 38 | 15 | 10 |
| managers | 3 | 4 | 5 | 2 | 3 | 3 | 2 |

#### ceo / peers-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 4 | 4 | 4 |
| summed request ms | 6 | 6 | 6 |
| db ms | 4 | 4 | 4 |
| statements | 6 | 6 | 6 |
| transactions | 4 | 4 | 4 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| members-member | 3 | 3 | 3 | 2 | 2 | 3 | 2 |

#### ceo / subordinates-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 21 | 22 | 22 |
| summed request ms | 27 | 28 | 28 |
| db ms | 22 | 23 | 23 |
| statements | 46 | 46 | 46 |
| transactions | 15 | 15 | 15 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| members-managed | 3 | 20 | 22 | 18 | 19 | 39 | 11 |
| succession-own | 3 | 3 | 3 | 2 | 2 | 4 | 2 |

#### ceo / subordinates-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 35 | 37 | 37 |
| summed request ms | 41 | 49 | 50 |
| db ms | 36 | 45 | 46 |
| statements | 70 | 70 | 70 |
| transactions | 15 | 15 | 15 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 6 | 2 | 5 | 3 | 2 |
| members-managed | 3 | 35 | 37 | 32 | 34 | 63 | 11 |
| succession-own | 3 | 4 | 6 | 3 | 6 | 4 | 2 |

#### ceo / my-teams-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 2 | 3 | 3 |
| summed request ms | 2 | 2 | 2 |
| db ms | 1 | 1 | 1 |
| statements | 3 | 3 | 3 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-managed | 3 | 2 | 2 | 1 | 1 | 3 | 2 |