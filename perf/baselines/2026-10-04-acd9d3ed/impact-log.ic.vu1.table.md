### impact-log — ic, 3 iterations/VU, 1 VU

requests 16, failed rate 0.00 %, responses without Server-Timing 0

#### ic / own

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 5 | 5 | 5 |
| elapsed wall ms | 5 | 6 | 6 |
| summed request ms | 17 | 20 | 21 |
| db ms | 11 | 13 | 14 |
| statements | 17 | 17 | 17 |
| transactions | 11 | 11 | 11 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 3 | 4 | 6 | 3 |
| shell-probe | 3 | 3 | 3 | 2 | 2 | 3 | 2 |
| shell-alerts | 3 | 3 | 3 | 1 | 2 | 2 | 2 |
| shell-bell | 3 | 3 | 5 | 2 | 3 | 3 | 2 |
| own | 3 | 4 | 4 | 3 | 3 | 3 | 2 |