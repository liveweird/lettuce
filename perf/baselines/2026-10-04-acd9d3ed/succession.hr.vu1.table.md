### succession — hr, 3 iterations/VU, 1 VU

requests 35, failed rate 0.00 %, responses without Server-Timing 0

#### hr / drilldown-audit

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 11 | 11 | 11 |
| elapsed wall ms | 44 | 49 | 49 |
| summed request ms | 62 | 65 | 66 |
| db ms | 49 | 49 | 49 |
| statements | 65 | 65 | 65 |
| transactions | 23 | 23 | 23 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 5 | 7 | 4 | 5 | 5 | 3 |
| shell-probe | 3 | 4 | 4 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 4 | 5 | 3 | 3 | 2 | 2 |
| shell-bell | 3 | 3 | 5 | 3 | 3 | 3 | 2 |
| users | 18 | 6 | 9 | 5 | 8 | 8 | 2 |
| list | 3 | 7 | 7 | 4 | 5 | 4 | 2 |