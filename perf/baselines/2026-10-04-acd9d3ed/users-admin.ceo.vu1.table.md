### users-admin — ceo, 3 iterations/VU, 1 VU

requests 286, failed rate 0.00 %, responses without Server-Timing 0

#### ceo / org-chart

| per screen load | p50 | p95 | max |
|---|---:|---:|---:|
| requests | 95 | 95 | 95 |
| elapsed wall ms | 109 | 109 | 109 |
| summed request ms | 523 | 597 | 605 |
| db ms | 423 | 454 | 457 |
| statements | 496 | 496 | 496 |
| transactions | 275 | 275 | 275 |

| endpoint | n | wall p50 | wall p95 | db p50 | db p95 | stmt p50 | tx p50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| shell-user | 3 | 4 | 5 | 2 | 4 | 6 | 3 |
| shell-probe | 3 | 2 | 3 | 1 | 2 | 3 | 2 |
| shell-alerts | 3 | 2 | 3 | 1 | 1 | 2 | 2 |
| shell-bell | 3 | 4 | 4 | 3 | 3 | 3 | 2 |
| teams-all | 3 | 3 | 4 | 2 | 3 | 3 | 2 |
| team | 252 | 3 | 5 | 2 | 4 | 5 | 3 |
| users-all | 18 | 42 | 50 | 39 | 49 | 12 | 2 |