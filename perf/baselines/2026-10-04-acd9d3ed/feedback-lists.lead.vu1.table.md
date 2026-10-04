### feedback-lists — lead, 3 iterations/VU, 1 VU

requests 40, failed rate 0.00 %, responses without Server-Timing 0

#### lead / received

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 10 | 14 | 14 |
| summed request ms | 22 | 34 | 36 |
| db ms | 16 | 24 | 25 |
| statements | 18 | 18 | 18 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 6 | 2 | 4 | 6 | 3 |
| shell-probe | 3 | 2 | 4 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 4 | 5 | 2 | 2 | 2 | 2 |
| shell-bell | 3 | 4 | 8 | 3 | 4 | 3 | 2 |
| received | 3 | 10 | 12 | 9 | 10 | 4 | 2 |

#### lead / provided

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 4 | 4 |
| summed request ms | 3 | 3 | 3 |
| db ms | 3 | 3 | 3 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| provided | 3 | 3 | 3 | 3 | 3 | 4 | 2 |

#### lead / team

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 10 | 11 | 11 |
| summed request ms | 10 | 11 | 11 |
| db ms | 9 | 10 | 11 |
| statements | 5 | 5 | 5 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| team | 3 | 10 | 11 | 9 | 10 | 5 | 2 |

#### lead / kudos

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 20 | 21 | 21 |
| summed request ms | 32 | 34 | 34 |
| db ms | 26 | 28 | 28 |
| statements | 22 | 22 | 22 |
| transactions | 13 | 13 | 13 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 2 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 4 | 3 | 3 | 3 | 2 |
| kudos | 6 | 9 | 11 | 9 | 10 | 4 | 2 |