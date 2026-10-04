### dashboard — lead, 3 iterations/VU, 1 VU

requests 37, failed rate 0.00 %, responses without Server-Timing 0

#### lead / first-load

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 27 | 28 | 28 |
| summed request ms | 62 | 71 | 72 |
| db ms | 47 | 56 | 57 |
| statements | 41 | 41 | 41 |
| transactions | 27 | 27 | 27 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 8 | 9 | 5 | 7 | 6 | 3 |
| shell-probe | 3 | 5 | 7 | 3 | 6 | 3 | 2 |
| shell-alerts | 3 | 5 | 7 | 3 | 6 | 2 | 2 |
| shell-bell | 3 | 6 | 10 | 3 | 4 | 3 | 2 |
| summary | 3 | 26 | 27 | 23 | 24 | 16 | 11 |
| managers | 3 | 11 | 12 | 7 | 10 | 11 | 7 |

#### lead / peers-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 2 | 2 | 2 |
| elapsed wall ms | 10 | 11 | 11 |
| summed request ms | 12 | 13 | 13 |
| db ms | 9 | 9 | 10 |
| statements | 16 | 16 | 16 |
| transactions | 10 | 10 | 10 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| members-member | 3 | 10 | 10 | 7 | 8 | 13 | 8 |

#### lead / subordinates-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 3 | 3 | 3 |
| elapsed wall ms | 17 | 19 | 19 |
| summed request ms | 23 | 24 | 24 |
| db ms | 19 | 20 | 20 |
| statements | 40 | 40 | 40 |
| transactions | 15 | 15 | 15 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-all | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| members-managed | 3 | 17 | 18 | 14 | 15 | 33 | 11 |
| succession-own | 3 | 3 | 4 | 2 | 3 | 4 | 2 |

#### lead / my-teams-tab

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 2 | 2 | 2 |
| summed request ms | 2 | 2 | 2 |
| db ms | 1 | 1 | 1 |
| statements | 3 | 3 | 3 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| teams-managed | 3 | 2 | 2 | 1 | 1 | 3 | 2 |