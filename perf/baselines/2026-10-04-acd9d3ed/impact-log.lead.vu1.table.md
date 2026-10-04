### impact-log — lead, 3 iterations/VU, 1 VU

requests 53, failed rate 0.00 %, responses without Server-Timing 0

#### lead / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 5 | 7 | 7 |
| summed request ms | 18 | 24 | 24 |
| db ms | 12 | 16 | 17 |
| statements | 17 | 17 | 17 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 6 | 3 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 4 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 5 | 6 | 3 | 4 | 3 | 2 |
| own | 3 | 5 | 5 | 3 | 3 | 3 | 2 |

#### lead / managed

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 1 | 1 | 1 |
| elapsed wall ms | 4 | 4 | 4 |
| summed request ms | 4 | 4 | 4 |
| db ms | 3 | 3 | 3 |
| statements | 4 | 4 | 4 |
| transactions | 2 | 2 | 2 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| managed | 3 | 4 | 4 | 3 | 3 | 4 | 2 |

#### lead / drilldown

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 50 | 50 | 50 |
| summed request ms | 59 | 62 | 62 |
| db ms | 48 | 50 | 51 |
| statements | 79 | 79 | 79 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 2 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 4 | 3 | 3 | 3 | 2 |
| users | 18 | 7 | 8 | 6 | 7 | 10 | 2 |
| list | 3 | 4 | 4 | 3 | 4 | 5 | 2 |