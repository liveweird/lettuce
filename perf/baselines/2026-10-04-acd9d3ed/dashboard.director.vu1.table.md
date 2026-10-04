### dashboard — director, 3 iterations/VU, 1 VU

requests 46, failed rate 0.00 %, responses without Server-Timing 0

#### director / first-load

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 22 | 26 | 26 |
| summed request ms | 49 | 54 | 55 |
| db ms | 37 | 40 | 40 |
| statements | 41 | 41 | 41 |
| transactions | 27 | 27 | 27 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 6 | 4 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 4 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 4 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 5 | 6 | 4 | 4 | 3 | 2 |
| summary | 3 | 22 | 25 | 20 | 21 | 16 | 11 |
| managers | 3 | 9 | 10 | 7 | 7 | 11 | 7 |

#### director / peers-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 11 | 12 | 12 |
| summed request ms | 12 | 14 | 14 |
| db ms | 10 | 10 | 10 |
| statements | 16 | 16 | 16 |
| transactions | 10 | 10 | 10 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| members-member | 3 | 10 | 11 | 8 | 9 | 13 | 8 |

#### director / subordinates-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 18 | 19 | 19 |
| summed request ms | 23 | 25 | 25 |
| db ms | 19 | 20 | 20 |
| statements | 40 | 40 | 40 |
| transactions | 15 | 15 | 15 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| members-managed | 3 | 18 | 18 | 15 | 16 | 33 | 11 |
| succession-own | 3 | 3 | 4 | 3 | 3 | 4 | 2 |

#### director / subordinates-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 27 | 27 | 27 |
| summed request ms | 32 | 34 | 34 |
| db ms | 28 | 29 | 29 |
| statements | 68 | 68 | 68 |
| transactions | 15 | 15 | 15 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| members-managed | 3 | 26 | 27 | 24 | 24 | 61 | 11 |
| succession-own | 3 | 3 | 4 | 3 | 3 | 4 | 2 |

#### director / my-teams-tab

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