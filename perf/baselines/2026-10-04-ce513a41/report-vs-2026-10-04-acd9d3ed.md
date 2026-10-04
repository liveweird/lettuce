# Perf report — `v4140`
baseline: `2026-10-04-acd9d3ed` (flags: ms at +/-10 % and more than 2 ms apart; counts: any change; statement calls: any change in .vu1 runs; NEW/MISSING sub-metrics)

## dashboard.ceo.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:ceo,screen:first-load,endpoint:managers} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ceo,screen:first-load,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ceo,screen:first-load,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ceo,screen:first-load,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo,screen:first-load,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:ceo,screen:first-load,endpoint:summary} | median | 15 | 15 | +0.0 |  |
| req_stmt{persona:ceo,screen:my-teams-tab,endpoint:teams-managed} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo,screen:peers-tab,endpoint:members-member} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ceo,screen:peers-tab,endpoint:teams-all} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo,screen:subordinates-all,endpoint:members-managed} | median | 63 | 25 | -60.3 | CHANGED |
| req_stmt{persona:ceo,screen:subordinates-all,endpoint:succession-own} | median | 4 | 4 | +0.0 |  |
| req_stmt{persona:ceo,screen:subordinates-all,endpoint:teams-all} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo,screen:subordinates-tab,endpoint:members-managed} | median | 39 | 21 | -46.2 | CHANGED |
| req_stmt{persona:ceo,screen:subordinates-tab,endpoint:succession-own} | median | 4 | 4 | +0.0 |  |
| req_stmt{persona:ceo,screen:subordinates-tab,endpoint:teams-all} | median | 3 | 4 | +33.3 | CHANGED |
| req_tx{persona:ceo,screen:first-load,endpoint:managers} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:first-load,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:first-load,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:first-load,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:first-load,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ceo,screen:first-load,endpoint:summary} | median | 10 | 10 | +0.0 |  |
| req_tx{persona:ceo,screen:my-teams-tab,endpoint:teams-managed} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:peers-tab,endpoint:members-member} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:peers-tab,endpoint:teams-all} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:subordinates-all,endpoint:members-managed} | median | 11 | 11 | +0.0 |  |
| req_tx{persona:ceo,screen:subordinates-all,endpoint:succession-own} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:subordinates-all,endpoint:teams-all} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:subordinates-tab,endpoint:members-managed} | median | 11 | 11 | +0.0 |  |
| req_tx{persona:ceo,screen:subordinates-tab,endpoint:succession-own} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:subordinates-tab,endpoint:teams-all} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:managers} | p95 (med) | 4.9 (4.0) | 4.0 (3.1) | -17.7 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:shell-alerts} | p95 (med) | 3.3 (3.2) | 2.9 (2.4) | -12.1 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:shell-bell} | p95 (med) | 4.5 (4.4) | 4.0 (2.8) | -10.4 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:shell-probe} | p95 (med) | 3.7 (2.9) | 3.3 (3.2) | -8.5 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:shell-user} | p95 (med) | 4.8 (4.5) | 4.7 (4.6) | -0.7 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:summary} | p95 (med) | 41.2 (27.2) | 24.6 (19.4) | -40.1 | improved |
| req_wall_ms{persona:ceo,screen:my-teams-tab,endpoint:teams-managed} | p95 (med) | 2.3 (2.1) | 1.4 (1.4) | -37.9 |  |
| req_wall_ms{persona:ceo,screen:peers-tab,endpoint:members-member} | p95 (med) | 3.0 (2.9) | 2.0 (2.0) | -32.3 |  |
| req_wall_ms{persona:ceo,screen:peers-tab,endpoint:teams-all} | p95 (med) | 3.2 (3.1) | 3.8 (2.5) | +17.7 |  |
| req_wall_ms{persona:ceo,screen:subordinates-all,endpoint:members-managed} | p95 (med) | 36.6 (34.7) | 14.3 (13.0) | -60.9 | improved |
| req_wall_ms{persona:ceo,screen:subordinates-all,endpoint:succession-own} | p95 (med) | 6.5 (3.6) | 3.3 (2.8) | -49.6 | improved |
| req_wall_ms{persona:ceo,screen:subordinates-all,endpoint:teams-all} | p95 (med) | 6.2 (2.8) | 3.8 (3.2) | -38.6 | improved |
| req_wall_ms{persona:ceo,screen:subordinates-tab,endpoint:members-managed} | p95 (med) | 21.5 (20.3) | 13.9 (10.9) | -35.4 | improved |
| req_wall_ms{persona:ceo,screen:subordinates-tab,endpoint:succession-own} | p95 (med) | 3.2 (3.2) | 2.9 (2.6) | -10.5 |  |
| req_wall_ms{persona:ceo,screen:subordinates-tab,endpoint:teams-all} | p95 (med) | 3.1 (3.0) | 6.3 (3.7) | +99.6 | REGRESSED |
| screen_db_ms{persona:ceo,screen:first-load} | p95 (med) | 50.6 (37.4) | 33.0 (27.6) | -34.8 | improved |
| screen_db_ms{persona:ceo,screen:my-teams-tab} | p95 (med) | 1.4 (1.3) | 0.9 (0.9) | -35.3 |  |
| screen_db_ms{persona:ceo,screen:peers-tab} | p95 (med) | 4.2 (4) | 4.2 (3.2) | +0.2 |  |
| screen_db_ms{persona:ceo,screen:subordinates-all} | p95 (med) | 44.7 (36.2) | 17.2 (16.5) | -61.4 | improved |
| screen_db_ms{persona:ceo,screen:subordinates-tab} | p95 (med) | 23.2 (22.3) | 18.5 (13) | -20.3 | improved |
| screen_requests{persona:ceo,screen:first-load} | median | 6 | 6 | +0.0 |  |
| screen_requests{persona:ceo,screen:my-teams-tab} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:ceo,screen:peers-tab} | median | 2 | 2 | +0.0 |  |
| screen_requests{persona:ceo,screen:subordinates-all} | median | 3 | 3 | +0.0 |  |
| screen_requests{persona:ceo,screen:subordinates-tab} | median | 3 | 3 | +0.0 |  |
| screen_seq_ms{persona:ceo,screen:first-load} | p95 (med) | 60.4 (48.6) | 43.3 (34.0) | -28.2 | improved |
| screen_seq_ms{persona:ceo,screen:my-teams-tab} | p95 (med) | 2.3 (2.1) | 1.4 (1.4) | -37.9 |  |
| screen_seq_ms{persona:ceo,screen:peers-tab} | p95 (med) | 6.1 (5.8) | 5.8 (4.4) | -4.6 |  |
| screen_seq_ms{persona:ceo,screen:subordinates-all} | p95 (med) | 49.3 (40.8) | 20.8 (19.8) | -57.7 | improved |
| screen_seq_ms{persona:ceo,screen:subordinates-tab} | p95 (med) | 27.7 (26.6) | 22.3 (16.8) | -19.6 | improved |
| screen_stmt{persona:ceo,screen:first-load} | median | 32 | 33 | +3.1 | CHANGED |
| screen_stmt{persona:ceo,screen:my-teams-tab} | median | 3 | 4 | +33.3 | CHANGED |
| screen_stmt{persona:ceo,screen:peers-tab} | median | 6 | 7 | +16.7 | CHANGED |
| screen_stmt{persona:ceo,screen:subordinates-all} | median | 70 | 33 | -52.9 | CHANGED |
| screen_stmt{persona:ceo,screen:subordinates-tab} | median | 46 | 29 | -37.0 | CHANGED |
| screen_tx{persona:ceo,screen:first-load} | median | 21 | 21 | +0.0 |  |
| screen_tx{persona:ceo,screen:my-teams-tab} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:ceo,screen:peers-tab} | median | 4 | 4 | +0.0 |  |
| screen_tx{persona:ceo,screen:subordinates-all} | median | 15 | 15 | +0.0 |  |
| screen_tx{persona:ceo,screen:subordinates-tab} | median | 15 | 15 | +0.0 |  |
| screen_wall_ms{persona:ceo,screen:first-load} | p95 (med) | 41.5 (28) | 25.4 (20) | -38.8 | improved |
| screen_wall_ms{persona:ceo,screen:my-teams-tab} | p95 (med) | 2.9 (2) | 1.9 (1) | -34.5 |  |
| screen_wall_ms{persona:ceo,screen:peers-tab} | p95 (med) | 4 (4) | 3.9 (3) | -2.5 |  |
| screen_wall_ms{persona:ceo,screen:subordinates-all} | p95 (med) | 36.8 (35) | 14.8 (13) | -59.8 | improved |
| screen_wall_ms{persona:ceo,screen:subordinates-tab} | p95 (med) | 21.9 (21) | 14.7 (12) | -32.9 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT feedbacks.id, feedbacks.last_modified FROM feedbacks WHERE ((feedbacks.subject_id =` | 6 | 6 | +0.0 | 26.3 | 23.5 |  |
| `SELECT goals.id, goals.manager_id, goals.subordinate_id, goals.title, goals."type", goals.` | 3 | 3 | +0.0 | 17.7 | 0 |  |
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 90 | - | - | 8.4 | - | GONE |
| `SELECT performance_reviews.id, performance_reviews.manager_id, performance_reviews.subordi` | 3 | 3 | +0.0 | 6.6 | 3.6 |  |
| `SELECT DISTINCT ON (one_on_one_meetings.subordinate_id) one_on_one_meetings.id, one_on_one` | - | 3 | - | - | 3.4 | NEW |
| `SELECT DISTINCT ON (one_on_one_meetings.subordinate_id) one_on_one_meetings.id, one_on_one` | - | 3 | - | - | 3.4 | NEW |
| `SELECT performance_reviews.id, review_periods.start_month, review_periods.end_month, perfo` | 90 | - | - | 1.6 | - | GONE |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 3 | 3 | +0.0 | 1.6 | 1.4 |  |
| `SELECT feedback_events.feedback_id, feedback_events.created_at, feedback_events.event_type` | 18 | 18 | +0.0 | 1.3 | 1 |  |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 3 | 3 | +0.0 | 1.1 | 1.1 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 1519 | 69 | improved |
| review_periods | 609 | 15 | improved |
| revoked_tokens | 511 | 45 | improved |
| users | 75 | 12 | improved |
| dictionary_entries | 54 | 9 | improved |
| team_members | 51 | 24 | improved |
| user_roles | 51 | 4 | improved |
| user_disabled_features | 28 | 0 | improved |
| alerts | 13 | 3 | improved |
| days_off_pool_types | 12 | 12 |  |
| days_off_corrections | 6 | 6 |  |
| feedbacks | 6 | 6 |  |
| pulse_cycles | 3 | 3 |  |
| login_lockouts | 2 | 2 |  |
| app_settings | 1 | 0 | improved |

## one-on-ones.ceo.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:ceo,screen:detail-chain,endpoint:events} | median | 16 | 16 | +0.0 |  |
| req_stmt{persona:ceo,screen:detail-chain,endpoint:item-history} | median | 23 | 23 | +0.0 |  |
| req_stmt{persona:ceo,screen:detail-chain,endpoint:meeting} | median | 15 | 15 | +0.0 |  |
| req_stmt{persona:ceo,screen:detail-chain,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ceo,screen:detail-chain,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ceo,screen:detail-chain,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo,screen:detail-chain,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:ceo,screen:managed,endpoint:managed} | median | 15 | 6 | -60.0 | CHANGED |
| req_stmt{persona:ceo,screen:managed-latest,endpoint:managed} | median | 15 | 6 | -60.0 | CHANGED |
| req_stmt{persona:ceo,screen:own,endpoint:own} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ceo,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ceo,screen:own,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ceo,screen:own,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo,screen:own,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:ceo,screen:team,endpoint:team} | median | 26 | 7 | -73.1 | CHANGED |
| req_stmt{persona:ceo,screen:team-all,endpoint:team} | median | 29 | 10 | -65.5 | CHANGED |
| req_tx{persona:ceo,screen:detail-chain,endpoint:events} | median | 4 | 4 | +0.0 |  |
| req_tx{persona:ceo,screen:detail-chain,endpoint:item-history} | median | 4 | 4 | +0.0 |  |
| req_tx{persona:ceo,screen:detail-chain,endpoint:meeting} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ceo,screen:detail-chain,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:detail-chain,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:detail-chain,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:detail-chain,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ceo,screen:managed,endpoint:managed} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:managed-latest,endpoint:managed} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:own} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ceo,screen:team,endpoint:team} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:team-all,endpoint:team} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:events} | p95 (med) | 5.7 (5.6) | 5.4 (5.4) | -4.9 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:item-history} | p95 (med) | 9.4 (8.5) | 7.6 (5.2) | -19.4 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:meeting} | p95 (med) | 8.3 (7.7) | 6.9 (6.2) | -17.4 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:shell-alerts} | p95 (med) | 2.5 (2.5) | 2.4 (2.1) | -6.5 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:shell-bell} | p95 (med) | 4.9 (4.3) | 4.1 (3.4) | -16.4 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:shell-probe} | p95 (med) | 3.5 (3.3) | 2.9 (2.8) | -15.7 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:shell-user} | p95 (med) | 4.9 (4.7) | 3.9 (3.9) | -19.0 |  |
| req_wall_ms{persona:ceo,screen:managed,endpoint:managed} | p95 (med) | 8.0 (8.0) | 6.1 (5.1) | -24.0 |  |
| req_wall_ms{persona:ceo,screen:managed-latest,endpoint:managed} | p95 (med) | 49.0 (48.7) | 47.8 (47.0) | -2.5 |  |
| req_wall_ms{persona:ceo,screen:own,endpoint:own} | p95 (med) | 3.9 (3.3) | 6.0 (4.6) | +55.4 | REGRESSED |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-alerts} | p95 (med) | 3.9 (2.7) | 5.7 (4.5) | +46.2 |  |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-bell} | p95 (med) | 4.5 (4.4) | 6.6 (4.6) | +45.3 | REGRESSED |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-probe} | p95 (med) | 3.8 (3.0) | 6.2 (4.6) | +64.4 | REGRESSED |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-user} | p95 (med) | 5.1 (4.2) | 6.4 (5.3) | +26.8 |  |
| req_wall_ms{persona:ceo,screen:team,endpoint:team} | p95 (med) | 17.8 (17.5) | 15.1 (13.8) | -15.6 | improved |
| req_wall_ms{persona:ceo,screen:team-all,endpoint:team} | p95 (med) | 44.7 (40.4) | 33.4 (33.2) | -25.3 | improved |
| screen_db_ms{persona:ceo,screen:detail-chain} | p95 (med) | 30.4 (28.5) | 23.7 (21.9) | -22.0 | improved |
| screen_db_ms{persona:ceo,screen:managed-latest} | p95 (med) | 48.3 (48) | 47.1 (46.2) | -2.4 |  |
| screen_db_ms{persona:ceo,screen:managed} | p95 (med) | 7.3 (7.3) | 5.3 (4.6) | -27.1 |  |
| screen_db_ms{persona:ceo,screen:own} | p95 (med) | 14.0 (11.3) | 11.5 (11.5) | -17.9 | improved |
| screen_db_ms{persona:ceo,screen:team-all} | p95 (med) | 43.9 (39.6) | 32.4 (31.9) | -26.1 | improved |
| screen_db_ms{persona:ceo,screen:team} | p95 (med) | 17.2 (16.8) | 13.0 (12.9) | -24.3 | improved |
| screen_requests{persona:ceo,screen:detail-chain} | median | 7 | 7 | +0.0 |  |
| screen_requests{persona:ceo,screen:managed-latest} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:ceo,screen:managed} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:ceo,screen:own} | median | 5 | 5 | +0.0 |  |
| screen_requests{persona:ceo,screen:team-all} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:ceo,screen:team} | median | 1 | 1 | +0.0 |  |
| screen_seq_ms{persona:ceo,screen:detail-chain} | p95 (med) | 38.9 (36.2) | 31.1 (29.8) | -20.0 | improved |
| screen_seq_ms{persona:ceo,screen:managed-latest} | p95 (med) | 49.0 (48.7) | 47.8 (47.0) | -2.5 |  |
| screen_seq_ms{persona:ceo,screen:managed} | p95 (med) | 8.0 (8.0) | 6.1 (5.1) | -24.0 |  |
| screen_seq_ms{persona:ceo,screen:own} | p95 (med) | 21.1 (16.6) | 31.0 (23.7) | +47.0 | REGRESSED |
| screen_seq_ms{persona:ceo,screen:team-all} | p95 (med) | 44.7 (40.4) | 33.4 (33.2) | -25.3 | improved |
| screen_seq_ms{persona:ceo,screen:team} | p95 (med) | 17.8 (17.5) | 15.1 (13.8) | -15.6 | improved |
| screen_stmt{persona:ceo,screen:detail-chain} | median | 68 | 69 | +1.5 | CHANGED |
| screen_stmt{persona:ceo,screen:managed-latest} | median | 15 | 6 | -60.0 | CHANGED |
| screen_stmt{persona:ceo,screen:managed} | median | 15 | 6 | -60.0 | CHANGED |
| screen_stmt{persona:ceo,screen:own} | median | 17 | 18 | +5.9 | CHANGED |
| screen_stmt{persona:ceo,screen:team-all} | median | 29 | 10 | -65.5 | CHANGED |
| screen_stmt{persona:ceo,screen:team} | median | 26 | 7 | -73.1 | CHANGED |
| screen_tx{persona:ceo,screen:detail-chain} | median | 20 | 20 | +0.0 |  |
| screen_tx{persona:ceo,screen:managed-latest} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:ceo,screen:managed} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:ceo,screen:own} | median | 11 | 11 | +0.0 |  |
| screen_tx{persona:ceo,screen:team-all} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:ceo,screen:team} | median | 2 | 2 | +0.0 |  |
| screen_wall_ms{persona:ceo,screen:detail-chain} | p95 (med) | 23.9 (23) | 18.9 (18) | -20.9 | improved |
| screen_wall_ms{persona:ceo,screen:managed-latest} | p95 (med) | 49.9 (49) | 47.9 (47) | -4.0 |  |
| screen_wall_ms{persona:ceo,screen:managed} | p95 (med) | 8 (8) | 5.9 (5) | -26.2 | improved |
| screen_wall_ms{persona:ceo,screen:own} | p95 (med) | 5.9 (5) | 7.8 (6) | +32.2 |  |
| screen_wall_ms{persona:ceo,screen:team-all} | p95 (med) | 44.5 (40) | 33.9 (33) | -23.8 | improved |
| screen_wall_ms{persona:ceo,screen:team} | p95 (med) | 18 (18) | 15.8 (14) | -12.2 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT one_on_one_meetings.id, one_on_one_meetings.manager_id, one_on_one_meetings.subordi` | 15 | 15 | +0.0 | 191.3 | 189.3 |  |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 6 | 6 | +0.0 | 37.8 | 34.8 |  |
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 189 | 9 | -95.2 | 21.6 | 1.5 | CHANGED |
| `SELECT DISTINCT ON (one_on_one_meetings.manager_id, one_on_one_meetings.subordinate_id) on` | - | 6 | - | - | 17.2 | NEW |
| `SELECT DISTINCT ON (one_on_one_meetings.manager_id, one_on_one_meetings.subordinate_id) on` | - | 6 | - | - | 6.2 | NEW |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 6 | 6 | +0.0 | 2.5 | 2.6 |  |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 6 | 6 | +0.0 | 2.4 | 2 |  |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 3 | 3 | +0.0 | 2.1 | 2.3 |  |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 3 | 3 | +0.0 | 1.3 | 1.5 |  |
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 9 | 9 | +0.0 | 1 | 1 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 54 | 54 |  |
| revoked_tokens | 48 | 48 |  |
| users | 45 | 45 |  |
| one_on_one_meetings | 12 | 12 |  |
| team_members | 9 | 9 |  |
| user_roles | 8 | 8 |  |
| alerts | 6 | 6 |  |
| dictionary_entries | 6 | 6 |  |
| login_lockouts | 4 | 4 |  |

## pulse-results.hr.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:hr,screen:participation,endpoint:cycles} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:participation,endpoint:participation} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:hr,screen:participation,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:participation,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:participation,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:participation,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:comments} | median | 7 | 7 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:cycles} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:results} | median | 11 | 10 | -9.1 | CHANGED |
| req_stmt{persona:hr,screen:results,endpoint:shares} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:trend} | median | 264 | 8 | -97.0 | CHANGED |
| req_stmt{persona:hr,screen:results,endpoint:visible-teams} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:hr,screen:survey,endpoint:cycles} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:survey,endpoint:my-response} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:survey,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:survey,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:survey,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:survey,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:trend,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:trend,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:trend,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:trend,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:trend,endpoint:trend} | median | 264 | 8 | -97.0 | CHANGED |
| req_stmt{persona:hr,screen:trend,endpoint:visible-teams} | median | 6 | 6 | +0.0 |  |
| req_tx{persona:hr,screen:participation,endpoint:cycles} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:participation,endpoint:participation} | median | 6 | 6 | +0.0 |  |
| req_tx{persona:hr,screen:participation,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:participation,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:participation,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:participation,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:results,endpoint:comments} | median | 6 | 6 | +0.0 |  |
| req_tx{persona:hr,screen:results,endpoint:cycles} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:results,endpoint:results} | median | 9 | 7 | -22.2 | CHANGED |
| req_tx{persona:hr,screen:results,endpoint:shares} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:results,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:results,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:results,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:results,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:results,endpoint:trend} | median | 263 | 6 | -97.7 | CHANGED |
| req_tx{persona:hr,screen:results,endpoint:visible-teams} | median | 8 | 8 | +0.0 |  |
| req_tx{persona:hr,screen:survey,endpoint:cycles} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:survey,endpoint:my-response} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:survey,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:survey,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:survey,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:survey,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:trend,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:trend,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:trend,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:trend,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:trend,endpoint:trend} | median | 263 | 6 | -97.7 | CHANGED |
| req_tx{persona:hr,screen:trend,endpoint:visible-teams} | median | 8 | 8 | +0.0 |  |
| req_wall_ms{persona:hr,screen:participation,endpoint:cycles} | p95 (med) | 4.2 (3.8) | 43.9 (3.5) | +954.2 | REGRESSED |
| req_wall_ms{persona:hr,screen:participation,endpoint:participation} | p95 (med) | 10.5 (10.4) | 7.6 (7.2) | -27.3 | improved |
| req_wall_ms{persona:hr,screen:participation,endpoint:shell-alerts} | p95 (med) | 2.1 (2.0) | 43.4 (2.6) | +1978.7 | REGRESSED |
| req_wall_ms{persona:hr,screen:participation,endpoint:shell-bell} | p95 (med) | 2.8 (2.4) | 43.9 (3.2) | +1449.6 | REGRESSED |
| req_wall_ms{persona:hr,screen:participation,endpoint:shell-probe} | p95 (med) | 2.5 (2.5) | 43.5 (2.8) | +1629.0 | REGRESSED |
| req_wall_ms{persona:hr,screen:participation,endpoint:shell-user} | p95 (med) | 3.8 (3.2) | 44.7 (3.7) | +1077.2 | REGRESSED |
| req_wall_ms{persona:hr,screen:results,endpoint:comments} | p95 (med) | 39.0 (6.3) | 51.0 (8.3) | +30.7 | REGRESSED |
| req_wall_ms{persona:hr,screen:results,endpoint:cycles} | p95 (med) | 4.3 (4.3) | 3.0 (2.9) | -30.7 |  |
| req_wall_ms{persona:hr,screen:results,endpoint:results} | p95 (med) | 52.4 (12.3) | 55.2 (12.2) | +5.3 |  |
| req_wall_ms{persona:hr,screen:results,endpoint:shares} | p95 (med) | 3.4 (2.8) | 2.8 (2.6) | -19.1 |  |
| req_wall_ms{persona:hr,screen:results,endpoint:shell-alerts} | p95 (med) | 3.0 (1.9) | 3.2 (2.4) | +6.7 |  |
| req_wall_ms{persona:hr,screen:results,endpoint:shell-bell} | p95 (med) | 3.4 (2.5) | 3.2 (3.1) | -4.4 |  |
| req_wall_ms{persona:hr,screen:results,endpoint:shell-probe} | p95 (med) | 2.8 (2.4) | 2.9 (2.6) | +0.4 |  |
| req_wall_ms{persona:hr,screen:results,endpoint:shell-user} | p95 (med) | 3.5 (3.3) | 4.1 (3.6) | +15.0 |  |
| req_wall_ms{persona:hr,screen:results,endpoint:trend} | p95 (med) | 465.6 (412.6) | 77.1 (28.6) | -83.4 | improved |
| req_wall_ms{persona:hr,screen:results,endpoint:visible-teams} | p95 (med) | 6.4 (5.9) | 5.1 (4.7) | -20.0 |  |
| req_wall_ms{persona:hr,screen:survey,endpoint:cycles} | p95 (med) | 4.6 (3.8) | 4.1 (3.4) | -10.9 |  |
| req_wall_ms{persona:hr,screen:survey,endpoint:my-response} | p95 (med) | 2.5 (2.4) | 2.3 (2.1) | -7.3 |  |
| req_wall_ms{persona:hr,screen:survey,endpoint:shell-alerts} | p95 (med) | 3.2 (2.3) | 3.3 (3.0) | +3.4 |  |
| req_wall_ms{persona:hr,screen:survey,endpoint:shell-bell} | p95 (med) | 4.0 (2.6) | 4.3 (3.4) | +5.6 |  |
| req_wall_ms{persona:hr,screen:survey,endpoint:shell-probe} | p95 (med) | 3.0 (2.6) | 6.1 (2.8) | +100.5 | REGRESSED |
| req_wall_ms{persona:hr,screen:survey,endpoint:shell-user} | p95 (med) | 3.6 (3.4) | 4.7 (4.5) | +32.6 |  |
| req_wall_ms{persona:hr,screen:trend,endpoint:shell-alerts} | p95 (med) | 2.2 (2.0) | 1.9 (1.7) | -13.3 |  |
| req_wall_ms{persona:hr,screen:trend,endpoint:shell-bell} | p95 (med) | 2.5 (2.4) | 2.3 (2.2) | -6.8 |  |
| req_wall_ms{persona:hr,screen:trend,endpoint:shell-probe} | p95 (med) | 2.3 (2.2) | 2.4 (2.0) | +5.6 |  |
| req_wall_ms{persona:hr,screen:trend,endpoint:shell-user} | p95 (med) | 3.2 (3.1) | 3.3 (2.8) | +3.5 |  |
| req_wall_ms{persona:hr,screen:trend,endpoint:trend} | p95 (med) | 462.8 (419.9) | 96.7 (71.8) | -79.1 | improved |
| req_wall_ms{persona:hr,screen:trend,endpoint:visible-teams} | p95 (med) | 4.6 (4.2) | 4.3 (3.8) | -6.0 |  |
| screen_db_ms{persona:hr,screen:participation} | p95 (med) | 17.0 (16.5) | 218.9 (12.6) | +1184.5 | REGRESSED |
| screen_db_ms{persona:hr,screen:results} | p95 (med) | 24351.0 (23778.1) | 4985.6 (4602.5) | -79.5 | improved |
| screen_db_ms{persona:hr,screen:survey} | p95 (med) | 13.3 (11.1) | 12.6 (11.2) | -4.7 |  |
| screen_db_ms{persona:hr,screen:trend} | p95 (med) | 23889.1 (23622.9) | 4768.3 (4712.9) | -80.0 | improved |
| screen_requests{persona:hr,screen:participation} | median | 6 | 6 | +0.0 |  |
| screen_requests{persona:hr,screen:results} | median | 259 | 259 | +0.0 |  |
| screen_requests{persona:hr,screen:survey} | median | 6 | 6 | +0.0 |  |
| screen_requests{persona:hr,screen:trend} | median | 89 | 89 | +0.0 |  |
| screen_seq_ms{persona:hr,screen:participation} | p95 (med) | 25.0 (23.7) | 226.6 (22.6) | +805.9 | REGRESSED |
| screen_seq_ms{persona:hr,screen:results} | p95 (med) | 35541.9 (35235.3) | 6660.8 (6207.8) | -81.3 | improved |
| screen_seq_ms{persona:hr,screen:survey} | p95 (med) | 20.5 (17.1) | 24.7 (19.1) | +20.7 | REGRESSED |
| screen_seq_ms{persona:hr,screen:trend} | p95 (med) | 35874.2 (35555.9) | 5585.2 (5392.2) | -84.4 | improved |
| screen_stmt{persona:hr,screen:participation} | median | 21 | 21 | +0.0 |  |
| screen_stmt{persona:hr,screen:results} | median | 23708 | 2120 | -91.1 | CHANGED |
| screen_stmt{persona:hr,screen:survey} | median | 18 | 18 | +0.0 |  |
| screen_stmt{persona:hr,screen:trend} | median | 22195 | 691 | -96.9 | CHANGED |
| screen_tx{persona:hr,screen:participation} | median | 17 | 17 | +0.0 |  |
| screen_tx{persona:hr,screen:results} | median | 23369 | 1613 | -93.1 | CHANGED |
| screen_tx{persona:hr,screen:survey} | median | 14 | 14 | +0.0 |  |
| screen_tx{persona:hr,screen:trend} | median | 22109 | 521 | -97.6 | CHANGED |
| screen_wall_ms{persona:hr,screen:participation} | p95 (med) | 15 (15) | 52.5 (12) | +250.0 | REGRESSED |
| screen_wall_ms{persona:hr,screen:results} | p95 (med) | 6526.8 (6444) | 1200.5 (1115) | -81.6 | improved |
| screen_wall_ms{persona:hr,screen:survey} | p95 (med) | 7.9 (7) | 10.6 (7) | +34.2 | REGRESSED |
| screen_wall_ms{persona:hr,screen:trend} | p95 (med) | 6007.1 (5972) | 990.2 (911) | -83.5 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT pulse_responses.id, pulse_responses.cycle_id, pulse_responses.user_id, pulse_respon` | 65520 | - | - | 889.3 | - | GONE |
| `SELECT COUNT(*) FROM pulse_participants WHERE (pulse_participants.cycle_id = $1) AND (puls` | 65268 | - | - | 632.3 | - | GONE |
| `SELECT pulse_responses.cycle_id, pulse_responses.enps, pulse_responses.driver1, pulse_resp` | - | 756 | - | - | 280.5 | NEW |
| `SELECT pulse_participants.cycle_id, COUNT(pulse_participants.user_id) FROM pulse_participa` | - | 756 | - | - | 109.7 | NEW |
| `SELECT $1` | 136514 | 6482 | -95.3 | 94 | 6.5 | CHANGED |
| `SELECT pulse_cycles.id, pulse_cycles.status, pulse_cycles.planned_open_date, pulse_cycles.` | 1275 | 1275 | +0.0 | 58.9 | 60.1 |  |
| `SELECT team_members.user_id FROM team_members INNER JOIN teams ON team_members.team_id = t` | 1008 | 1008 | +0.0 | 11.2 | 11.1 |  |
| `SELECT document_shares.sharer_id FROM document_shares WHERE (document_shares.resource_type` | 504 | 504 | +0.0 | 6.2 | 7.6 |  |
| `SELECT teams.id, teams."name", teams.manager_id, teams.marked_as_deleted FROM teams WHERE ` | 1008 | 1008 | +0.0 | 7.1 | 7.3 |  |
| `SELECT team_members.team_id, team_members.user_id FROM team_members WHERE team_members.tea` | 1008 | 1008 | +0.0 | 6.6 | 6.7 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 2577 | 2577 |  |
| pulse_cycles | 1275 | 1275 |  |
| revoked_tokens | 1080 | 1080 |  |
| user_roles | 13 | 13 |  |
| alerts | 12 | 12 |  |
| team_members | 3 | 3 |  |
| users | 3 | 3 |  |
| login_lockouts | 2 | 2 |  |

## reviews-team-view.ceo-all.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| chain_requests{persona:ceo-all,chain:dictionaries} | median | 3 | 3 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:members} | median | 6 | 6 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:periods} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:probe} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:reviews} | median | 4 | 4 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:ceo-all,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_stmt{persona:ceo-all,chain:members} | median | 1151 | 143 | -87.6 | CHANGED |
| chain_stmt{persona:ceo-all,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_stmt{persona:ceo-all,chain:probe} | median | 3 | 4 | +33.3 | CHANGED |
| chain_stmt{persona:ceo-all,chain:reviews} | median | 28 | 28 | +0.0 |  |
| chain_stmt{persona:ceo-all,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:ceo-all,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:members} | median | 66 | 66 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:probe} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:reviews} | median | 8 | 8 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_wall_ms{persona:ceo-all,chain:dictionaries} | p95 (med) | 5.8 (5.1) | 6.1 (4.2) | +4.4 |  |
| chain_wall_ms{persona:ceo-all,chain:members} | p95 (med) | 457.3 (452.3) | 109.7 (106.5) | -76.0 | improved |
| chain_wall_ms{persona:ceo-all,chain:periods} | p95 (med) | 1.7 (1.5) | 1.7 (1.6) | -2.1 |  |
| chain_wall_ms{persona:ceo-all,chain:probe} | p95 (med) | 2.3 (2.2) | 2.8 (2.3) | +25.1 |  |
| chain_wall_ms{persona:ceo-all,chain:reviews} | p95 (med) | 48.4 (44.6) | 26.9 (25.7) | -44.4 | improved |
| chain_wall_ms{persona:ceo-all,chain:stray-roster} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| chain_wall_ms{persona:ceo-all,chain:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_stmt{persona:ceo-all,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ceo-all,endpoint:members} | median | 222 | 24 | -89.2 | CHANGED |
| req_stmt{persona:ceo-all,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ceo-all,endpoint:probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo-all,endpoint:reviews} | median | 7 | 7 | +0.0 |  |
| req_stmt{persona:ceo-all,endpoint:users} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:members} | median | 11 | 11 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:reviews} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:users} | median | 0 | 0 | +0.0 |  |
| req_wall_ms{persona:ceo-all,endpoint:dictionaries} | p95 (med) | 2.0 (1.6) | 2.4 (1.5) | +18.8 |  |
| req_wall_ms{persona:ceo-all,endpoint:members} | p95 (med) | 90.3 (85.2) | 20.8 (18.3) | -77.0 | improved |
| req_wall_ms{persona:ceo-all,endpoint:periods} | p95 (med) | 1.7 (1.5) | 1.7 (1.6) | -2.1 |  |
| req_wall_ms{persona:ceo-all,endpoint:probe} | p95 (med) | 2.3 (2.2) | 2.8 (2.3) | +25.1 |  |
| req_wall_ms{persona:ceo-all,endpoint:reviews} | p95 (med) | 13.6 (11.2) | 7.4 (6.4) | -45.1 | improved |
| req_wall_ms{persona:ceo-all,endpoint:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| screen_critical_ms{persona:ceo-all} | p95 (med) | 457.3 (452.3) | 109.7 (106.5) | -76.0 | improved |
| screen_db_ms{persona:ceo-all} | p95 (med) | 483.1 (475.2) | 120.2 (118.9) | -75.1 | improved |
| screen_requests{persona:ceo-all} | median | 15 | 15 | +0.0 |  |
| screen_stmt{persona:ceo-all} | median | 1190 | 183 | -84.6 | CHANGED |
| screen_tx{persona:ceo-all} | median | 84 | 84 | +0.0 |  |
| screen_wall_ms{persona:ceo-all} | p95 (med) | 514.4 (504.4) | 145.0 (142.3) | -71.8 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 1530 | - | - | 56.8 | - | GONE |
| `SELECT days_off_requests.user_id, days_off_requests.pool_type_id, days_off_requests.start_` | 15 | 15 | +0.0 | 14.3 | 6.3 |  |
| `SELECT performance_reviews.id, review_periods.start_month, review_periods.end_month, perfo` | 1530 | - | - | 12.9 | - | GONE |
| `SELECT DISTINCT ON (one_on_one_meetings.subordinate_id) one_on_one_meetings.id, one_on_one` | - | 15 | - | - | 8.3 | NEW |
| `SELECT performance_reviews.id, performance_reviews.manager_id, performance_reviews.subordi` | 12 | 12 | +0.0 | 4.8 | 4.7 |  |
| `SELECT feedbacks.id, feedback_subjects.user_id, feedbacks.last_modified FROM feedbacks INN` | 18 | 15 | -16.7 | 4.8 | 3 | CHANGED |
| `SELECT feedbacks.id, feedbacks.subject_id, feedbacks.last_modified FROM feedbacks WHERE (f` | 18 | 15 | -16.7 | 3.8 | 3.3 | CHANGED |
| `SELECT COUNT(*) FROM performance_reviews INNER JOIN users manager_users ON performance_rev` | 12 | 12 | +0.0 | 3.6 | 2.8 |  |
| `SELECT team_members.user_id FROM team_members INNER JOIN teams ON team_members.team_id = t` | 60 | 60 | +0.0 | 3.1 | 3.1 |  |
| `SELECT goals.subordinate_id, COUNT(goals.id) FROM goals WHERE (goals.manager_id = $1) AND ` | 18 | 15 | -16.7 | 2.9 | 2.6 | CHANGED |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| review_periods | 327 | 55 | improved |
| teams | 144 | 191 | MORE SEQ SCANS |
| team_members | 123 | 139 | MORE SEQ SCANS |
| users | 111 | 119 | MORE SEQ SCANS |
| revoked_tokens | 45 | 75 | MORE SEQ SCANS |
| days_off_pool_types | 36 | 44 | MORE SEQ SCANS |
| dictionary_entries | 27 | 33 | MORE SEQ SCANS |
| days_off_corrections | 18 | 22 | MORE SEQ SCANS |
| days_off_pools | 15 | 15 |  |
| feedbacks | 0 | 4 | NEW SEQ SCANS |
| login_lockouts | 2 | 3 | MORE SEQ SCANS |
| user_roles | 1 | 3 | MORE SEQ SCANS |
| alerts | 0 | 2 | NEW SEQ SCANS |
| pulse_cycles | 0 | 2 | NEW SEQ SCANS |
| app_settings | 0 | 1 | NEW SEQ SCANS |

## reviews-team-view.mixed.vu50
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| chain_requests{persona:ceo-all,chain:dictionaries} | median | 3 | 3 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:members} | median | 6 | 6 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:periods} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:probe} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:reviews} | median | 4 | 4 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_requests{persona:ceo-all,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_requests{persona:director-all,chain:dictionaries} | median | 3 | 3 | +0.0 |  |
| chain_requests{persona:director-all,chain:members} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:director-all,chain:periods} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:director-all,chain:probe} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:director-all,chain:reviews} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:director-all,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_requests{persona:director-all,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_requests{persona:hr,chain:dictionaries} | median | 3 | 3 | +0.0 |  |
| chain_requests{persona:hr,chain:members} | median | 0 | 0 | +0.0 |  |
| chain_requests{persona:hr,chain:periods} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:hr,chain:probe} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:hr,chain:reviews} | median | 6 | 6 | +0.0 |  |
| chain_requests{persona:hr,chain:stray-roster} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:hr,chain:users} | median | 6 | 6 | +0.0 |  |
| chain_requests{persona:lead,chain:dictionaries} | median | 3 | 3 | +0.0 |  |
| chain_requests{persona:lead,chain:members} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:lead,chain:periods} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:lead,chain:probe} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:lead,chain:reviews} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:lead,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_requests{persona:lead,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_requests{persona:lead-2,chain:dictionaries} | median | 3 | 3 | +0.0 |  |
| chain_requests{persona:lead-2,chain:members} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:lead-2,chain:periods} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:lead-2,chain:probe} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:lead-2,chain:reviews} | median | 1 | 1 | +0.0 |  |
| chain_requests{persona:lead-2,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_requests{persona:lead-2,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:ceo-all,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_stmt{persona:ceo-all,chain:members} | median | 1151 | 143 | -87.6 | CHANGED |
| chain_stmt{persona:ceo-all,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_stmt{persona:ceo-all,chain:probe} | median | 3 | 4 | +33.3 | CHANGED |
| chain_stmt{persona:ceo-all,chain:reviews} | median | 28 | 28 | +0.0 |  |
| chain_stmt{persona:ceo-all,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:ceo-all,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:director-all,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_stmt{persona:director-all,chain:members} | median | 134 | 24 | -82.1 | CHANGED |
| chain_stmt{persona:director-all,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_stmt{persona:director-all,chain:probe} | median | 3 | 4 | +33.3 | CHANGED |
| chain_stmt{persona:director-all,chain:reviews} | median | 6 | 6 | +0.0 |  |
| chain_stmt{persona:director-all,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:director-all,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:hr,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_stmt{persona:hr,chain:members} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:hr,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_stmt{persona:hr,chain:probe} | median | 3 | 3 | +0.0 |  |
| chain_stmt{persona:hr,chain:reviews} | median | 18 | 18 | +0.0 |  |
| chain_stmt{persona:hr,chain:stray-roster} | median | 3 | 3 | +0.0 |  |
| chain_stmt{persona:hr,chain:users} | median | 48 | 48 | +0.0 |  |
| chain_stmt{persona:lead,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_stmt{persona:lead,chain:members} | median | 33 | 21 | -36.4 | CHANGED |
| chain_stmt{persona:lead,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_stmt{persona:lead,chain:probe} | median | 3 | 4 | +33.3 | CHANGED |
| chain_stmt{persona:lead,chain:reviews} | median | 5 | 5 | +0.0 |  |
| chain_stmt{persona:lead,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:lead,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:lead-2,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_stmt{persona:lead-2,chain:members} | median | 31 | 21 | -32.3 | CHANGED |
| chain_stmt{persona:lead-2,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_stmt{persona:lead-2,chain:probe} | median | 3 | 4 | +33.3 | CHANGED |
| chain_stmt{persona:lead-2,chain:reviews} | median | 5 | 5 | +0.0 |  |
| chain_stmt{persona:lead-2,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_stmt{persona:lead-2,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:members} | median | 66 | 66 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:probe} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:reviews} | median | 8 | 8 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:ceo-all,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:director-all,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_tx{persona:director-all,chain:members} | median | 11 | 11 | +0.0 |  |
| chain_tx{persona:director-all,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:director-all,chain:probe} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:director-all,chain:reviews} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:director-all,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:director-all,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:hr,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_tx{persona:hr,chain:members} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:hr,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:hr,chain:probe} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:hr,chain:reviews} | median | 12 | 12 | +0.0 |  |
| chain_tx{persona:hr,chain:stray-roster} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:hr,chain:users} | median | 12 | 12 | +0.0 |  |
| chain_tx{persona:lead,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_tx{persona:lead,chain:members} | median | 11 | 11 | +0.0 |  |
| chain_tx{persona:lead,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:lead,chain:probe} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:lead,chain:reviews} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:lead,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:lead,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:lead-2,chain:dictionaries} | median | 6 | 6 | +0.0 |  |
| chain_tx{persona:lead-2,chain:members} | median | 11 | 11 | +0.0 |  |
| chain_tx{persona:lead-2,chain:periods} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:lead-2,chain:probe} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:lead-2,chain:reviews} | median | 2 | 2 | +0.0 |  |
| chain_tx{persona:lead-2,chain:stray-roster} | median | 0 | 0 | +0.0 |  |
| chain_tx{persona:lead-2,chain:users} | median | 0 | 0 | +0.0 |  |
| chain_wall_ms{persona:ceo-all,chain:dictionaries} | p95 (med) | 371.7 (293.3) | 199.1 (111.0) | -46.4 | improved |
| chain_wall_ms{persona:ceo-all,chain:members} | p95 (med) | 8600.4 (8102.6) | 2579.1 (1697.1) | -70.0 | improved |
| chain_wall_ms{persona:ceo-all,chain:periods} | p95 (med) | 177.9 (98.4) | 94.4 (23.7) | -46.9 | improved |
| chain_wall_ms{persona:ceo-all,chain:probe} | p95 (med) | 174.5 (102.4) | 92.8 (29.2) | -46.9 | improved |
| chain_wall_ms{persona:ceo-all,chain:reviews} | p95 (med) | 887.2 (780.4) | 421.1 (285.8) | -52.5 | improved |
| chain_wall_ms{persona:ceo-all,chain:stray-roster} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| chain_wall_ms{persona:ceo-all,chain:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| chain_wall_ms{persona:director-all,chain:dictionaries} | p95 (med) | 387.4 (301.0) | 197.2 (111.3) | -49.1 | improved |
| chain_wall_ms{persona:director-all,chain:members} | p95 (med) | 1219.8 (1095.7) | 421.4 (280.4) | -65.5 | improved |
| chain_wall_ms{persona:director-all,chain:periods} | p95 (med) | 169.4 (99.9) | 87.3 (24.5) | -48.5 | improved |
| chain_wall_ms{persona:director-all,chain:probe} | p95 (med) | 173.1 (100.6) | 91.2 (30.4) | -47.3 | improved |
| chain_wall_ms{persona:director-all,chain:reviews} | p95 (med) | 195.4 (120.4) | 97.9 (67.7) | -49.9 | improved |
| chain_wall_ms{persona:director-all,chain:stray-roster} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| chain_wall_ms{persona:director-all,chain:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| chain_wall_ms{persona:hr,chain:dictionaries} | p95 (med) | 376.6 (292.3) | 185.0 (108.7) | -50.9 | improved |
| chain_wall_ms{persona:hr,chain:members} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| chain_wall_ms{persona:hr,chain:periods} | p95 (med) | 145.4 (97.1) | 88.4 (23.3) | -39.2 | improved |
| chain_wall_ms{persona:hr,chain:probe} | p95 (med) | 169.7 (99.2) | 86.4 (25.2) | -49.1 | improved |
| chain_wall_ms{persona:hr,chain:reviews} | p95 (med) | 909.1 (821.1) | 473.2 (300.3) | -48.0 | improved |
| chain_wall_ms{persona:hr,chain:stray-roster} | p95 (med) | 167.2 (99.2) | 90.9 (24.5) | -45.6 | improved |
| chain_wall_ms{persona:hr,chain:users} | p95 (med) | 1045.1 (918.2) | 596.5 (381.1) | -42.9 | improved |
| chain_wall_ms{persona:lead,chain:dictionaries} | p95 (med) | 391.6 (303.1) | 204.4 (112.7) | -47.8 | improved |
| chain_wall_ms{persona:lead,chain:members} | p95 (med) | 775.5 (678.6) | 382.2 (242.4) | -50.7 | improved |
| chain_wall_ms{persona:lead,chain:periods} | p95 (med) | 173.5 (99.7) | 88.2 (23.9) | -49.1 | improved |
| chain_wall_ms{persona:lead,chain:probe} | p95 (med) | 175.9 (101.4) | 96.5 (45.5) | -45.1 | improved |
| chain_wall_ms{persona:lead,chain:reviews} | p95 (med) | 186.9 (108.8) | 99.7 (44.9) | -46.7 | improved |
| chain_wall_ms{persona:lead,chain:stray-roster} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| chain_wall_ms{persona:lead,chain:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| chain_wall_ms{persona:lead-2,chain:dictionaries} | p95 (med) | 391.1 (302.3) | 206.8 (113.0) | -47.1 | improved |
| chain_wall_ms{persona:lead-2,chain:members} | p95 (med) | 766.8 (631.4) | 381.8 (233.3) | -50.2 | improved |
| chain_wall_ms{persona:lead-2,chain:periods} | p95 (med) | 173.9 (100.3) | 88.8 (25.2) | -48.9 | improved |
| chain_wall_ms{persona:lead-2,chain:probe} | p95 (med) | 176.9 (101.0) | 95.0 (32.3) | -46.3 | improved |
| chain_wall_ms{persona:lead-2,chain:reviews} | p95 (med) | 186.3 (108.2) | 99.4 (57.9) | -46.6 | improved |
| chain_wall_ms{persona:lead-2,chain:stray-roster} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| chain_wall_ms{persona:lead-2,chain:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_stmt{persona:ceo-all,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ceo-all,endpoint:members} | median | 222 | 24 | -89.2 | CHANGED |
| req_stmt{persona:ceo-all,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ceo-all,endpoint:probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo-all,endpoint:reviews} | median | 7 | 7 | +0.0 |  |
| req_stmt{persona:ceo-all,endpoint:users} | median | 0 | 0 | +0.0 |  |
| req_stmt{persona:director-all,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:director-all,endpoint:members} | median | 134 | 24 | -82.1 | CHANGED |
| req_stmt{persona:director-all,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:director-all,endpoint:probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:director-all,endpoint:reviews} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:director-all,endpoint:users} | median | 0 | 0 | +0.0 |  |
| req_stmt{persona:hr,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,endpoint:members} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,endpoint:probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,endpoint:reviews} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,endpoint:users} | median | 8 | 8 | +0.0 |  |
| req_stmt{persona:lead,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,endpoint:members} | median | 33 | 21 | -36.4 | CHANGED |
| req_stmt{persona:lead,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,endpoint:probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:lead,endpoint:reviews} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:lead,endpoint:users} | median | 0 | 0 | +0.0 |  |
| req_stmt{persona:lead-2,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead-2,endpoint:members} | median | 31 | 21 | -32.3 | CHANGED |
| req_stmt{persona:lead-2,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead-2,endpoint:probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:lead-2,endpoint:reviews} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:lead-2,endpoint:users} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:members} | median | 11 | 11 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:reviews} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo-all,endpoint:users} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:director-all,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:director-all,endpoint:members} | median | 11 | 11 | +0.0 |  |
| req_tx{persona:director-all,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:director-all,endpoint:probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:director-all,endpoint:reviews} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:director-all,endpoint:users} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:hr,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,endpoint:members} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,endpoint:probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,endpoint:reviews} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,endpoint:members} | median | 11 | 11 | +0.0 |  |
| req_tx{persona:lead,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,endpoint:probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,endpoint:reviews} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,endpoint:users} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:lead-2,endpoint:dictionaries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead-2,endpoint:members} | median | 11 | 11 | +0.0 |  |
| req_tx{persona:lead-2,endpoint:periods} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead-2,endpoint:probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead-2,endpoint:reviews} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead-2,endpoint:users} | median | 0 | 0 | +0.0 |  |
| req_wall_ms{persona:ceo-all,endpoint:dictionaries} | p95 (med) | 164.7 (96.9) | 91.3 (24.6) | -44.6 | improved |
| req_wall_ms{persona:ceo-all,endpoint:members} | p95 (med) | 1679.4 (1457.3) | 434.0 (291.7) | -74.2 | improved |
| req_wall_ms{persona:ceo-all,endpoint:periods} | p95 (med) | 177.9 (98.4) | 94.4 (23.7) | -46.9 | improved |
| req_wall_ms{persona:ceo-all,endpoint:probe} | p95 (med) | 174.5 (102.4) | 92.8 (29.2) | -46.9 | improved |
| req_wall_ms{persona:ceo-all,endpoint:reviews} | p95 (med) | 269.4 (195.9) | 115.6 (79.8) | -57.1 | improved |
| req_wall_ms{persona:ceo-all,endpoint:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_wall_ms{persona:director-all,endpoint:dictionaries} | p95 (med) | 170.8 (99.7) | 87.6 (24.7) | -48.7 | improved |
| req_wall_ms{persona:director-all,endpoint:members} | p95 (med) | 1219.8 (1095.7) | 421.4 (280.4) | -65.5 | improved |
| req_wall_ms{persona:director-all,endpoint:periods} | p95 (med) | 169.4 (99.9) | 87.3 (24.5) | -48.5 | improved |
| req_wall_ms{persona:director-all,endpoint:probe} | p95 (med) | 173.1 (100.6) | 91.2 (30.4) | -47.3 | improved |
| req_wall_ms{persona:director-all,endpoint:reviews} | p95 (med) | 195.4 (120.4) | 97.9 (67.7) | -49.9 | improved |
| req_wall_ms{persona:director-all,endpoint:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_wall_ms{persona:hr,endpoint:dictionaries} | p95 (med) | 138.3 (96.9) | 85.2 (23.2) | -38.4 | improved |
| req_wall_ms{persona:hr,endpoint:members} | p95 (med) | 167.2 (99.2) | 90.9 (24.5) | -45.6 | improved |
| req_wall_ms{persona:hr,endpoint:periods} | p95 (med) | 145.4 (97.1) | 88.4 (23.3) | -39.2 | improved |
| req_wall_ms{persona:hr,endpoint:probe} | p95 (med) | 169.7 (99.2) | 86.4 (25.2) | -49.1 | improved |
| req_wall_ms{persona:hr,endpoint:reviews} | p95 (med) | 195.2 (120.6) | 96.0 (58.8) | -50.8 | improved |
| req_wall_ms{persona:hr,endpoint:users} | p95 (med) | 204.1 (174.2) | 111.6 (74.4) | -45.3 | improved |
| req_wall_ms{persona:lead,endpoint:dictionaries} | p95 (med) | 173.3 (100.4) | 89.6 (25.3) | -48.3 | improved |
| req_wall_ms{persona:lead,endpoint:members} | p95 (med) | 775.5 (678.6) | 382.2 (242.4) | -50.7 | improved |
| req_wall_ms{persona:lead,endpoint:periods} | p95 (med) | 173.5 (99.7) | 88.2 (23.9) | -49.1 | improved |
| req_wall_ms{persona:lead,endpoint:probe} | p95 (med) | 175.9 (101.4) | 96.5 (45.5) | -45.1 | improved |
| req_wall_ms{persona:lead,endpoint:reviews} | p95 (med) | 186.9 (108.8) | 99.7 (44.9) | -46.7 | improved |
| req_wall_ms{persona:lead,endpoint:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_wall_ms{persona:lead-2,endpoint:dictionaries} | p95 (med) | 172.7 (100.2) | 89.7 (25.5) | -48.1 | improved |
| req_wall_ms{persona:lead-2,endpoint:members} | p95 (med) | 766.8 (631.4) | 381.8 (233.3) | -50.2 | improved |
| req_wall_ms{persona:lead-2,endpoint:periods} | p95 (med) | 173.9 (100.3) | 88.8 (25.2) | -48.9 | improved |
| req_wall_ms{persona:lead-2,endpoint:probe} | p95 (med) | 176.9 (101.0) | 95.0 (32.3) | -46.3 | improved |
| req_wall_ms{persona:lead-2,endpoint:reviews} | p95 (med) | 186.3 (108.2) | 99.4 (57.9) | -46.6 | improved |
| req_wall_ms{persona:lead-2,endpoint:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| screen_critical_ms{persona:ceo-all} | p95 (med) | 8600.4 (8102.6) | 2579.1 (1697.1) | -70.0 | improved |
| screen_critical_ms{persona:director-all} | p95 (med) | 1219.8 (1095.7) | 421.4 (280.4) | -65.5 | improved |
| screen_critical_ms{persona:hr} | p95 (med) | 1154.0 (1034.3) | 672.7 (414.5) | -41.7 | improved |
| screen_critical_ms{persona:lead-2} | p95 (med) | 766.8 (631.4) | 381.8 (233.3) | -50.2 | improved |
| screen_critical_ms{persona:lead} | p95 (med) | 775.5 (678.6) | 382.2 (242.4) | -50.7 | improved |
| screen_db_ms{persona:ceo-all} | p95 (med) | 9318.5 (8786.6) | 2890.5 (1932.6) | -69.0 | improved |
| screen_db_ms{persona:director-all} | p95 (med) | 1779.8 (1583.9) | 702.5 (461.3) | -60.5 | improved |
| screen_db_ms{persona:hr} | p95 (med) | 2267.1 (2058.4) | 1188.1 (778.0) | -47.6 | improved |
| screen_db_ms{persona:lead-2} | p95 (med) | 1305.2 (1133.5) | 668.7 (426.0) | -48.8 | improved |
| screen_db_ms{persona:lead} | p95 (med) | 1312.4 (1148.7) | 665.3 (428) | -49.3 | improved |
| screen_requests{persona:ceo-all} | median | 15 | 15 | +0.0 |  |
| screen_requests{persona:director-all} | median | 7 | 7 | +0.0 |  |
| screen_requests{persona:hr} | median | 18 | 18 | +0.0 |  |
| screen_requests{persona:lead-2} | median | 7 | 7 | +0.0 |  |
| screen_requests{persona:lead} | median | 7 | 7 | +0.0 |  |
| screen_stmt{persona:ceo-all} | median | 1190 | 183 | -84.6 | CHANGED |
| screen_stmt{persona:director-all} | median | 151 | 42 | -72.2 | CHANGED |
| screen_stmt{persona:hr} | median | 80 | 80 | +0.0 |  |
| screen_stmt{persona:lead-2} | median | 47 | 38 | -19.1 | CHANGED |
| screen_stmt{persona:lead} | median | 49 | 38 | -22.4 | CHANGED |
| screen_tx{persona:ceo-all} | median | 84 | 84 | +0.0 |  |
| screen_tx{persona:director-all} | median | 23 | 23 | +0.0 |  |
| screen_tx{persona:hr} | median | 36 | 36 | +0.0 |  |
| screen_tx{persona:lead-2} | median | 23 | 23 | +0.0 |  |
| screen_tx{persona:lead} | median | 23 | 23 | +0.0 |  |
| screen_wall_ms{persona:ceo-all} | p95 (med) | 9869.2 (9364.8) | 3307.3 (2179.3) | -66.5 | improved |
| screen_wall_ms{persona:director-all} | p95 (med) | 1896.9 (1722.9) | 805.8 (516.6) | -57.5 | improved |
| screen_wall_ms{persona:hr} | p95 (med) | 2490.0 (2370.7) | 1392.3 (897.3) | -44.1 | improved |
| screen_wall_ms{persona:lead-2} | p95 (med) | 1404.3 (1290.2) | 784.7 (495.4) | -44.1 | improved |
| screen_wall_ms{persona:lead} | p95 (med) | 1406.9 (1295.3) | 791.1 (495.9) | -43.8 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 178195 | - | - | 12183.9 | - | GONE |
| `SELECT performance_reviews.id, performance_reviews.manager_id, performance_reviews.subordi` | 9269 | 15894 | +71.5 | 3519.4 | 5530.7 |  |
| `SELECT DISTINCT ON (one_on_one_meetings.subordinate_id) one_on_one_meetings.id, one_on_one` | - | 4472 | - | - | 3995.5 | NEW |
| `SELECT DISTINCT ON (one_on_one_meetings.subordinate_id) one_on_one_meetings.id, one_on_one` | - | 4648 | - | - | 3980.7 | NEW |
| `SELECT performance_reviews.id, review_periods.start_month, review_periods.end_month, perfo` | 178195 | - | - | 2711.8 | - | GONE |
| `SELECT days_off_requests.user_id, days_off_requests.pool_type_id, days_off_requests.start_` | 4854 | 6886 | +41.9 | 1045 | 2020.3 |  |
| `SELECT COUNT(*) FROM performance_reviews INNER JOIN users manager_users ON performance_rev` | 4614 | 7284 | +57.9 | 1363.3 | 1932.6 |  |
| `SELECT goals.subordinate_id, COUNT(goals.id) FROM goals WHERE (goals.manager_id = $1) AND ` | 3811 | 6886 | +80.7 | 638.3 | 1307.8 |  |
| `SELECT feedbacks.id, feedback_subjects.user_id, feedbacks.last_modified FROM feedbacks INN` | 4854 | 9120 | +87.9 | 736.7 | 1230.1 |  |
| `SELECT feedbacks.id, feedbacks.subject_id, feedbacks.last_modified FROM feedbacks WHERE (f` | 2038 | 4648 | +128.1 | 430.3 | 953.9 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| review_periods | 299245 | 335486 | MORE SEQ SCANS |
| teams | 42882 | 79859 | MORE SEQ SCANS |
| users | 42533 | 75954 | MORE SEQ SCANS |
| revoked_tokens | 43840 | 75492 | MORE SEQ SCANS |
| dictionary_entries | 24148 | 41796 | MORE SEQ SCANS |
| team_members | 16225 | 35653 | MORE SEQ SCANS |
| days_off_pool_types | 10106 | 19260 | MORE SEQ SCANS |
| days_off_corrections | 5053 | 9630 | MORE SEQ SCANS |
| days_off_pools | 4687 | 8924 | MORE SEQ SCANS |
| user_roles | 4619 | 7289 | MORE SEQ SCANS |
| user_disabled_features | 3845 | 6070 | MORE SEQ SCANS |
| login_lockouts | 10 | 10 |  |

## users-admin.admin.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:admin,screen:org-chart,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:admin,screen:org-chart,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:admin,screen:org-chart,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:admin,screen:org-chart,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:admin,screen:org-chart,endpoint:teams-all} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:admin,screen:org-chart,endpoint:team} | median | 6 | - | - | MISSING |
| req_stmt{persona:admin,screen:org-chart,endpoint:users-all} | median | 9 | 9 | +0.0 |  |
| req_stmt{persona:admin,screen:teams,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:admin,screen:teams,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:admin,screen:teams,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:admin,screen:teams,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:admin,screen:teams,endpoint:teams} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:admin,screen:teams,endpoint:users-all} | median | 9 | 9 | +0.0 |  |
| req_stmt{persona:admin,screen:users,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:admin,screen:users,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:admin,screen:users,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:admin,screen:users,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:admin,screen:users,endpoint:users} | median | 9 | 9 | +0.0 |  |
| req_stmt{persona:admin,screen:users-deep,endpoint:users} | median | 9 | 9 | +0.0 |  |
| req_stmt{persona:admin,screen:users-filtered,endpoint:users} | median | 4 | 4 | +0.0 |  |
| req_tx{persona:admin,screen:org-chart,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:org-chart,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:org-chart,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:org-chart,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:admin,screen:org-chart,endpoint:teams-all} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:org-chart,endpoint:team} | median | 3 | - | - | MISSING |
| req_tx{persona:admin,screen:org-chart,endpoint:users-all} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:teams,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:teams,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:teams,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:teams,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:admin,screen:teams,endpoint:teams} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:teams,endpoint:users-all} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:admin,screen:users,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users-deep,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users-filtered,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:shell-alerts} | p95 (med) | 3.9 (2.3) | 3.8 (1.9) | -2.3 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:shell-bell} | p95 (med) | 3.5 (2.7) | 3.9 (2.5) | +11.2 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:shell-probe} | p95 (med) | 3.5 (2.8) | 3.7 (2.1) | +3.0 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:shell-user} | p95 (med) | 4.6 (3.8) | 3.8 (3.3) | -17.7 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:teams-all} | p95 (med) | 4.0 (3.0) | 4.8 (3.4) | +21.7 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:team} | p95 (med) | 5.7 (3.6) | - (-) | - | MISSING |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:users-all} | p95 (med) | 16.6 (11.0) | 5.0 (3.2) | -69.9 | improved |
| req_wall_ms{persona:admin,screen:teams,endpoint:shell-alerts} | p95 (med) | 2.5 (2.3) | 3.1 (2.5) | +24.5 |  |
| req_wall_ms{persona:admin,screen:teams,endpoint:shell-bell} | p95 (med) | 3.3 (3.0) | 4.2 (2.4) | +28.0 |  |
| req_wall_ms{persona:admin,screen:teams,endpoint:shell-probe} | p95 (med) | 2.8 (2.5) | 3.2 (2.2) | +15.7 |  |
| req_wall_ms{persona:admin,screen:teams,endpoint:shell-user} | p95 (med) | 4.3 (3.8) | 4.2 (4.2) | -0.3 |  |
| req_wall_ms{persona:admin,screen:teams,endpoint:teams} | p95 (med) | 3.0 (2.9) | 2.8 (2.7) | -8.4 |  |
| req_wall_ms{persona:admin,screen:teams,endpoint:users-all} | p95 (med) | 8.3 (6.1) | 5.7 (3.4) | -31.5 | improved |
| req_wall_ms{persona:admin,screen:users,endpoint:shell-alerts} | p95 (med) | 3.1 (2.7) | 2.7 (2.4) | -13.0 |  |
| req_wall_ms{persona:admin,screen:users,endpoint:shell-bell} | p95 (med) | 3.6 (3.2) | 3.5 (2.2) | -2.1 |  |
| req_wall_ms{persona:admin,screen:users,endpoint:shell-probe} | p95 (med) | 3.1 (2.9) | 3.0 (2.1) | -4.3 |  |
| req_wall_ms{persona:admin,screen:users,endpoint:shell-user} | p95 (med) | 4.0 (3.3) | 4.0 (2.8) | +1.8 |  |
| req_wall_ms{persona:admin,screen:users,endpoint:users} | p95 (med) | 6.4 (6.3) | 5.9 (3.8) | -7.9 |  |
| req_wall_ms{persona:admin,screen:users-deep,endpoint:users} | p95 (med) | 4.9 (4.0) | 3.5 (2.9) | -28.4 |  |
| req_wall_ms{persona:admin,screen:users-filtered,endpoint:users} | p95 (med) | 6.9 (3.1) | 4.4 (2.8) | -37.0 | improved |
| screen_db_ms{persona:admin,screen:org-chart} | p95 (med) | 302.6 (296.2) | 28.4 (24.3) | -90.6 | improved |
| screen_db_ms{persona:admin,screen:teams} | p95 (med) | 45.8 (39.1) | 25.5 (25.4) | -44.3 | improved |
| screen_db_ms{persona:admin,screen:users-deep} | p95 (med) | 4.1 (3.4) | 2.9 (2.2) | -29.1 |  |
| screen_db_ms{persona:admin,screen:users-filtered} | p95 (med) | 6.1 (2.3) | 2.1 (2) | -65.6 | improved |
| screen_db_ms{persona:admin,screen:users} | p95 (med) | 13.8 (12.9) | 10.4 (8.7) | -24.6 | improved |
| screen_requests{persona:admin,screen:org-chart} | median | 95 | 11 | -88.4 | CHANGED |
| screen_requests{persona:admin,screen:teams} | median | 11 | 11 | +0.0 |  |
| screen_requests{persona:admin,screen:users-deep} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:admin,screen:users-filtered} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:admin,screen:users} | median | 5 | 5 | +0.0 |  |
| screen_seq_ms{persona:admin,screen:org-chart} | p95 (med) | 420.3 (403.4) | 40.9 (34.0) | -90.3 | improved |
| screen_seq_ms{persona:admin,screen:teams} | p95 (med) | 58.9 (49.9) | 37.8 (35.4) | -35.8 | improved |
| screen_seq_ms{persona:admin,screen:users-deep} | p95 (med) | 4.9 (4.0) | 3.5 (2.9) | -28.4 |  |
| screen_seq_ms{persona:admin,screen:users-filtered} | p95 (med) | 6.9 (3.1) | 4.4 (2.8) | -37.0 | improved |
| screen_seq_ms{persona:admin,screen:users} | p95 (med) | 19.5 (19.2) | 19.0 (13.2) | -2.1 |  |
| screen_stmt{persona:admin,screen:org-chart} | median | 558 | 71 | -87.3 | CHANGED |
| screen_stmt{persona:admin,screen:teams} | median | 70 | 71 | +1.4 | CHANGED |
| screen_stmt{persona:admin,screen:users-deep} | median | 9 | 9 | +0.0 |  |
| screen_stmt{persona:admin,screen:users-filtered} | median | 4 | 4 | +0.0 |  |
| screen_stmt{persona:admin,screen:users} | median | 22 | 22 | +0.0 |  |
| screen_tx{persona:admin,screen:org-chart} | median | 275 | 23 | -91.6 | CHANGED |
| screen_tx{persona:admin,screen:teams} | median | 23 | 23 | +0.0 |  |
| screen_tx{persona:admin,screen:users-deep} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:admin,screen:users-filtered} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:admin,screen:users} | median | 11 | 11 | +0.0 |  |
| screen_wall_ms{persona:admin,screen:org-chart} | p95 (med) | 107.2 (82) | 25 (25) | -76.7 | improved |
| screen_wall_ms{persona:admin,screen:teams} | p95 (med) | 48.3 (42) | 27.9 (27) | -42.2 | improved |
| screen_wall_ms{persona:admin,screen:users-deep} | p95 (med) | 4.9 (4) | 3.9 (3) | -20.4 |  |
| screen_wall_ms{persona:admin,screen:users-filtered} | p95 (med) | 6.6 (3) | 4.8 (3) | -27.3 |  |
| screen_wall_ms{persona:admin,screen:users} | p95 (med) | 7 (7) | 6.7 (4) | -4.3 |  |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT teams.manager_id FROM team_members INNER JOIN teams ON team_members.team_id = teams` | 708 | - | - | 10.2 | - | GONE |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 30 | 30 | +0.0 | 3.1 | 4 |  |
| `SELECT teams."name", teams.manager_id, users."name", users.marked_as_deleted FROM teams IN` | 252 | - | - | 3.6 | - | GONE |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 42 | - | - | 1.9 | - | GONE |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | - | 42 | - | - | 1.8 | NEW |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 30 | 30 | +0.0 | 1.7 | 1.6 |  |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 42 | 42 | +0.0 | 1.4 | 1.3 |  |
| `SELECT team_members.team_id, team_members.user_id FROM team_members WHERE team_members.tea` | 252 | - | - | 1.4 | - | GONE |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 30 | 30 | +0.0 | 1.2 | 1 |  |
| `SELECT $1` | 944 | 188 | -80.1 | 1 | 0.2 | CHANGED |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 1077 | 117 | improved |
| revoked_tokens | 339 | 87 | improved |
| users | 72 | 72 |  |
| user_roles | 52 | 52 |  |
| dictionary_entries | 42 | 42 |  |
| user_disabled_features | 30 | 30 |  |
| team_members | 5 | 18 | MORE SEQ SCANS |
| alerts | 9 | 9 |  |
| login_lockouts | 2 | 2 |  |

## users-admin.ceo.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:ceo,screen:org-chart,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ceo,screen:org-chart,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ceo,screen:org-chart,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo,screen:org-chart,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:ceo,screen:org-chart,endpoint:teams-all} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo,screen:org-chart,endpoint:team} | median | 5 | - | - | MISSING |
| req_stmt{persona:ceo,screen:org-chart,endpoint:users-all} | median | 12 | 12 | +0.0 |  |
| req_tx{persona:ceo,screen:org-chart,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:org-chart,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:org-chart,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:org-chart,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ceo,screen:org-chart,endpoint:teams-all} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:org-chart,endpoint:team} | median | 3 | - | - | MISSING |
| req_tx{persona:ceo,screen:org-chart,endpoint:users-all} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:shell-alerts} | p95 (med) | 3.1 (2.3) | 5.2 (3.2) | +64.4 | REGRESSED |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:shell-bell} | p95 (med) | 4.1 (3.7) | 6.4 (3.9) | +54.8 | REGRESSED |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:shell-probe} | p95 (med) | 3.5 (2.4) | 5.2 (3.4) | +50.7 |  |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:shell-user} | p95 (med) | 4.8 (3.7) | 5.6 (4.2) | +15.1 |  |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:teams-all} | p95 (med) | 4.2 (3.3) | 6.1 (4.4) | +46.5 |  |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:team} | p95 (med) | 5.0 (3.2) | - (-) | - | MISSING |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:users-all} | p95 (med) | 50.3 (41.5) | 7.5 (5.1) | -85.2 | improved |
| screen_db_ms{persona:ceo,screen:org-chart} | p95 (med) | 453.7 (423.1) | 46.0 (37.7) | -89.9 | improved |
| screen_requests{persona:ceo,screen:org-chart} | median | 95 | 11 | -88.4 | CHANGED |
| screen_seq_ms{persona:ceo,screen:org-chart} | p95 (med) | 596.7 (523.3) | 63.4 (48.9) | -89.4 | improved |
| screen_stmt{persona:ceo,screen:org-chart} | median | 496 | 91 | -81.7 | CHANGED |
| screen_tx{persona:ceo,screen:org-chart} | median | 275 | 23 | -91.6 | CHANGED |
| screen_wall_ms{persona:ceo,screen:org-chart} | p95 (med) | 109 (109) | 42.9 (42) | -60.6 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT teams.manager_id FROM team_members INNER JOIN teams ON team_members.team_id = teams` | 465 | - | - | 8 | - | GONE |
| `SELECT teams."name", teams.manager_id, users."name", users.marked_as_deleted FROM teams IN` | 252 | - | - | 3.5 | - | GONE |
| `SELECT team_members.user_id FROM team_members INNER JOIN teams ON team_members.team_id = t` | - | 54 | - | - | 2.3 | NEW |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | 15 | +0.0 | 1.6 | 2.2 |  |
| `SELECT team_members.user_id FROM team_members INNER JOIN teams ON team_members.team_id = t` | 36 | - | - | 2.1 | - | GONE |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 3 | 3 | +0.0 | 1.4 | 2 |  |
| `SELECT team_members.team_id, team_members.user_id FROM team_members WHERE team_members.tea` | 252 | 3 | -98.8 | 1.3 | 0 | CHANGED |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 3 | 3 | +0.0 | 1 | 0.9 |  |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 15 | 15 | +0.0 | 0.9 | 0.8 |  |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 18 | 18 | +0.0 | 0.9 | 0.8 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 819 | 102 | improved |
| revoked_tokens | 285 | 33 | improved |
| team_members | 54 | 59 | MORE SEQ SCANS |
| users | 27 | 27 |  |
| user_roles | 22 | 22 |  |
| dictionary_entries | 21 | 21 |  |
| user_disabled_features | 15 | 15 |  |
| alerts | 3 | 3 |  |
| login_lockouts | 2 | 2 |  |

## users-admin.ic.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:ic,screen:org-chart,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ic,screen:org-chart,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ic,screen:org-chart,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ic,screen:org-chart,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:ic,screen:org-chart,endpoint:teams-all} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ic,screen:org-chart,endpoint:team} | median | 6 | - | - | MISSING |
| req_stmt{persona:ic,screen:org-chart,endpoint:users-all} | median | 9 | 9 | +0.0 |  |
| req_stmt{persona:ic,screen:teams,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ic,screen:teams,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ic,screen:teams,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ic,screen:teams,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:ic,screen:teams,endpoint:teams} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ic,screen:teams,endpoint:users-all} | median | 9 | 9 | +0.0 |  |
| req_stmt{persona:ic,screen:users,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ic,screen:users,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ic,screen:users,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ic,screen:users,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:ic,screen:users,endpoint:users} | median | 9 | 9 | +0.0 |  |
| req_tx{persona:ic,screen:org-chart,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:org-chart,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:org-chart,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:org-chart,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ic,screen:org-chart,endpoint:teams-all} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:org-chart,endpoint:team} | median | 3 | - | - | MISSING |
| req_tx{persona:ic,screen:org-chart,endpoint:users-all} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:teams,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:teams,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:teams,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:teams,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ic,screen:teams,endpoint:teams} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:teams,endpoint:users-all} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:users,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:users,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:users,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:users,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ic,screen:users,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:shell-alerts} | p95 (med) | 2.9 (2.2) | 3.2 (1.8) | +10.2 |  |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:shell-bell} | p95 (med) | 3.5 (2.7) | 3.9 (3.0) | +9.9 |  |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:shell-probe} | p95 (med) | 3.0 (2.8) | 3.8 (2.4) | +25.6 |  |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:shell-user} | p95 (med) | 3.7 (3.6) | 5.5 (3.3) | +49.0 |  |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:teams-all} | p95 (med) | 3.3 (3.0) | 5.4 (3.5) | +61.0 | REGRESSED |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:team} | p95 (med) | 5.8 (3.4) | - (-) | - | MISSING |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:users-all} | p95 (med) | 11.9 (10.1) | 5.9 (3.2) | -50.3 | improved |
| req_wall_ms{persona:ic,screen:teams,endpoint:shell-alerts} | p95 (med) | 2.5 (1.9) | 2.8 (2.1) | +11.3 |  |
| req_wall_ms{persona:ic,screen:teams,endpoint:shell-bell} | p95 (med) | 3.3 (3.1) | 2.7 (2.6) | -18.3 |  |
| req_wall_ms{persona:ic,screen:teams,endpoint:shell-probe} | p95 (med) | 2.9 (2.8) | 2.8 (2.5) | -3.1 |  |
| req_wall_ms{persona:ic,screen:teams,endpoint:shell-user} | p95 (med) | 3.7 (3.7) | 5.1 (3.2) | +36.0 |  |
| req_wall_ms{persona:ic,screen:teams,endpoint:teams} | p95 (med) | 2.9 (2.6) | 4.4 (2.8) | +52.0 |  |
| req_wall_ms{persona:ic,screen:teams,endpoint:users-all} | p95 (med) | 7.6 (6.0) | 5.3 (3.4) | -30.4 | improved |
| req_wall_ms{persona:ic,screen:users,endpoint:shell-alerts} | p95 (med) | 2.8 (2.0) | 3.7 (2.1) | +31.3 |  |
| req_wall_ms{persona:ic,screen:users,endpoint:shell-bell} | p95 (med) | 4.0 (2.9) | 4.2 (2.3) | +4.2 |  |
| req_wall_ms{persona:ic,screen:users,endpoint:shell-probe} | p95 (med) | 3.2 (2.1) | 4.3 (1.8) | +34.1 |  |
| req_wall_ms{persona:ic,screen:users,endpoint:shell-user} | p95 (med) | 3.7 (3.5) | 3.9 (3.1) | +5.8 |  |
| req_wall_ms{persona:ic,screen:users,endpoint:users} | p95 (med) | 5.8 (5.0) | 5.6 (3.6) | -3.9 |  |
| screen_db_ms{persona:ic,screen:org-chart} | p95 (med) | 279.4 (275.0) | 30.8 (27.5) | -89.0 | improved |
| screen_db_ms{persona:ic,screen:teams} | p95 (med) | 40.8 (39.5) | 30.6 (24.8) | -25.0 | improved |
| screen_db_ms{persona:ic,screen:users} | p95 (med) | 12.6 (11.5) | 12.7 (8.3) | +1.0 |  |
| screen_requests{persona:ic,screen:org-chart} | median | 95 | 11 | -88.4 | CHANGED |
| screen_requests{persona:ic,screen:teams} | median | 11 | 11 | +0.0 |  |
| screen_requests{persona:ic,screen:users} | median | 5 | 5 | +0.0 |  |
| screen_seq_ms{persona:ic,screen:org-chart} | p95 (med) | 392.5 (388.7) | 42.9 (38.4) | -89.1 | improved |
| screen_seq_ms{persona:ic,screen:teams} | p95 (med) | 51.8 (48.4) | 42.9 (33.1) | -17.2 | improved |
| screen_seq_ms{persona:ic,screen:users} | p95 (med) | 19.3 (15.7) | 21.6 (12.7) | +11.9 | REGRESSED |
| screen_stmt{persona:ic,screen:org-chart} | median | 559 | 72 | -87.1 | CHANGED |
| screen_stmt{persona:ic,screen:teams} | median | 71 | 72 | +1.4 | CHANGED |
| screen_stmt{persona:ic,screen:users} | median | 23 | 23 | +0.0 |  |
| screen_tx{persona:ic,screen:org-chart} | median | 275 | 23 | -91.6 | CHANGED |
| screen_tx{persona:ic,screen:teams} | median | 23 | 23 | +0.0 |  |
| screen_tx{persona:ic,screen:users} | median | 11 | 11 | +0.0 |  |
| screen_wall_ms{persona:ic,screen:org-chart} | p95 (med) | 97.4 (74) | 28.6 (25) | -70.6 | improved |
| screen_wall_ms{persona:ic,screen:teams} | p95 (med) | 40.8 (39) | 32.6 (29) | -20.1 | improved |
| screen_wall_ms{persona:ic,screen:users} | p95 (med) | 6 (6) | 6.7 (4) | +11.7 |  |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT teams.manager_id FROM team_members INNER JOIN teams ON team_members.team_id = teams` | 708 | - | - | 9.7 | - | GONE |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 30 | 30 | +0.0 | 3.7 | 3.3 |  |
| `SELECT teams."name", teams.manager_id, users."name", users.marked_as_deleted FROM teams IN` | 252 | - | - | 3.5 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 30 | 30 | +0.0 | 1.7 | 1.8 |  |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 9 | 9 | +0.0 | 1.5 | 1.7 |  |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 39 | 39 | +0.0 | 1.7 | 1.7 |  |
| `SELECT team_members.team_id, team_members.user_id FROM team_members WHERE team_members.tea` | 252 | - | - | 1.4 | - | GONE |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 39 | 39 | +0.0 | 1.3 | 1.2 |  |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 9 | 9 | +0.0 | 1.2 | 1.2 |  |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 30 | 30 | +0.0 | 1.1 | 1.1 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 1068 | 108 | improved |
| revoked_tokens | 333 | 81 | improved |
| users | 60 | 60 |  |
| user_roles | 49 | 49 |  |
| dictionary_entries | 48 | 48 |  |
| user_disabled_features | 30 | 30 |  |
| team_members | 3 | 12 | MORE SEQ SCANS |
| alerts | 9 | 9 |  |
| login_lockouts | 2 | 2 |  |

Baseline runs with no counterpart in this run: `activity-log.ceo.vu1`, `activity-log.director.vu1`, `activity-log.hr.vu1`, `activity-log.ic.vu1`, `activity-log.lead.vu1`, `dashboard.admin.vu1`, `dashboard.director.vu1`, `dashboard.hr.vu1`, `dashboard.ic.vu1`, `dashboard.lead.vu1`, `days-off.ceo.vu1`, `days-off.director.vu1`, `days-off.hr.vu1`, `days-off.ic.vu1`, `days-off.lead.vu1`, `feedback-lists.ceo.vu1`, `feedback-lists.hr.vu1`, `feedback-lists.ic.vu1`, `feedback-lists.lead.vu1`, `impact-log.ceo.vu1`, `impact-log.hr.vu1`, `impact-log.ic.vu1`, `impact-log.lead.vu1`, `login.ic.vu1`, `login.mixed.vu50`, `mixed-50vu.mixed.vu50`, `notifications-bell.ceo.vu1`, `notifications-bell.hr.vu1`, `notifications-bell.ic.vu1`, `one-on-ones.director.vu1`, `one-on-ones.hr.vu1`, `one-on-ones.ic.vu1`, `one-on-ones.lead.vu1`, `pulse-results.ceo.vu1`, `pulse-results.ic.vu1`, `pulse-results.lead.vu1`, `reviews-team-view.ceo-all.vu50`, `reviews-team-view.ceo-direct.vu1`, `reviews-team-view.director-all.vu1`, `reviews-team-view.director-all.vu50`, `reviews-team-view.hr.vu1`, `reviews-team-view.hr.vu50`, `reviews-team-view.lead-2.vu1`, `reviews-team-view.lead.vu1`, `reviews-team-view.lead.vu50`, `succession.ceo.vu1`, `succession.hr.vu1`, `succession.lead.vu1`, `team-kpis.ceo.vu1`, `team-kpis.hr.vu1`, `team-kpis.ic.vu1`, `team-kpis.lead.vu1`
