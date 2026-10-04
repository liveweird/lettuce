### one-on-ones — director, 3 iterations/VU, 1 VU

requests 29, failed rate 0.00 %, responses without Server-Timing 0

#### director / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 6 | 10 | 10 |
| summed request ms | 21 | 32 | 33 |
| db ms | 15 | 19 | 20 |
| statements | 20 | 20 | 20 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 6 | 4 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 7 | 2 | 4 | 3 | 2 |
| shell-alerts | 3 | 2 | 5 | 1 | 3 | 2 | 2 |
| shell-bell | 3 | 5 | 6 | 3 | 3 | 3 | 2 |
| own | 3 | 6 | 9 | 5 | 6 | 6 | 2 |

#### director / managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 6 | 7 | 7 |
| summed request ms | 6 | 7 | 7 |
| db ms | 5 | 6 | 6 |
| statements | 12 | 12 | 12 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 6 | 7 | 5 | 6 | 12 | 2 |

#### director / managed-latest

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 38 | 40 | 40 |
| summed request ms | 37 | 39 | 40 |
| db ms | 37 | 39 | 39 |
| statements | 12 | 12 | 12 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 37 | 39 | 37 | 39 | 12 | 2 |

#### director / team

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 15 | 16 | 16 |
| summed request ms | 15 | 16 | 16 |
| db ms | 14 | 15 | 15 |
| statements | 26 | 26 | 26 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 15 | 16 | 14 | 15 | 26 | 2 |

#### director / team-all

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 17 | 19 | 19 |
| summed request ms | 17 | 18 | 18 |
| db ms | 16 | 17 | 17 |
| statements | 28 | 28 | 28 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 17 | 18 | 16 | 17 | 28 | 2 |