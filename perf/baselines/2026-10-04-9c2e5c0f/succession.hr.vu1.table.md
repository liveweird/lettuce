### succession — hr, 3 iterations/VU, 1 VU

requests 20, failed rate 0.00 %, responses without Server-Timing 0

#### hr / drilldown-audit

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 6 | 6 | 6 |
| elapsed wall ms | 5 | 9 | 9 |
| summed request ms | 19 | 43 | 45 |
| db ms | 11 | 25 | 27 |
| statements | 25 | 25 | 25 |
| transactions | 13 | 13 | 13 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 3 | 7 | 2 | 2 | 5 | 3 |
| shell-probe | 3 | 4 | 6 | 3 | 4 | 3 | 2 |
| shell-alerts | 3 | 3 | 7 | 1 | 5 | 2 | 2 |
| shell-bell | 3 | 3 | 7 | 2 | 4 | 3 | 2 |
| users | 3 | 3 | 8 | 2 | 6 | 8 | 2 |
| list | 3 | 4 | 8 | 3 | 4 | 4 | 2 |