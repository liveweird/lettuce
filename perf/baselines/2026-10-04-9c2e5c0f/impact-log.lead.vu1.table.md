### impact-log — lead, 3 iterations/VU, 1 VU

requests 38, failed rate 0.00 %, responses without Server-Timing 0

#### lead / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 5 | 6 | 6 |
| summed request ms | 14 | 18 | 19 |
| db ms | 9 | 9 | 9 |
| statements | 18 | 18 | 18 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 3 | 2 | 2 | 6 | 3 |
| shell-probe | 3 | 2 | 5 | 2 | 2 | 4 | 2 |
| shell-alerts | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 5 | 3 | 3 | 3 | 2 |
| own | 3 | 3 | 3 | 2 | 2 | 3 | 2 |

#### lead / managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 3 | 3 | 3 |
| summed request ms | 3 | 4 | 4 |
| db ms | 2 | 2 | 2 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 3 | 4 | 2 | 2 | 4 | 2 |

#### lead / drilldown

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 6 | 10 | 10 |
| summed request ms | 22 | 45 | 48 |
| db ms | 16 | 30 | 32 |
| statements | 30 | 30 | 30 |
| transactions | 13 | 13 | 13 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 8 | 3 | 6 | 6 | 3 |
| shell-probe | 3 | 3 | 7 | 2 | 6 | 4 | 2 |
| shell-alerts | 3 | 2 | 7 | 1 | 5 | 2 | 2 |
| shell-bell | 3 | 5 | 8 | 3 | 7 | 3 | 2 |
| users | 3 | 6 | 9 | 3 | 4 | 10 | 2 |
| list | 3 | 5 | 7 | 3 | 4 | 5 | 2 |