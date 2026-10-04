# Perf report — `v4150`
baseline: `2026-10-04-acd9d3ed` (flags: ms at +/-10 % and more than 2 ms apart; counts: any change; statement calls: any change in .vu1 runs; NEW/MISSING sub-metrics)

## activity-log.ceo.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:ceo,screen:own,endpoint:activity} | median | 11 | 13 | +18.2 | CHANGED |
| req_stmt{persona:ceo,screen:own,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_stmt{persona:ceo,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ceo,screen:own,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ceo,screen:own,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo,screen:own,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:ceo,screen:report,endpoint:activity} | median | 13 | 14 | +7.7 | CHANGED |
| req_stmt{persona:ceo,screen:report,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_stmt{persona:ceo,screen:report,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:ceo,screen:report,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:ceo,screen:report,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ceo,screen:report,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:ceo,screen:report,endpoint:users} | median | 12 | 12 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:activity} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:own,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ceo,screen:report,endpoint:activity} | median | 4 | 4 | +0.0 |  |
| req_tx{persona:ceo,screen:report,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:ceo,screen:report,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:report,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:report,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ceo,screen:report,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ceo,screen:report,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:ceo,screen:own,endpoint:activity} | p95 (med) | 21.9 (16.4) | 19.4 (15.1) | -11.1 | improved |
| req_wall_ms{persona:ceo,screen:own,endpoint:dictionaries} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-alerts} | p95 (med) | 3.6 (2.7) | 3.9 (3.8) | +10.3 |  |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-bell} | p95 (med) | 5.0 (4.9) | 10.4 (4.5) | +109.0 | REGRESSED |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-probe} | p95 (med) | 3.7 (3.6) | 4.5 (4.2) | +22.8 |  |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-user} | p95 (med) | 5.5 (4.3) | 12.8 (6.8) | +133.5 | REGRESSED |
| req_wall_ms{persona:ceo,screen:report,endpoint:activity} | p95 (med) | 46.5 (41.4) | 48.3 (46.3) | +4.0 |  |
| req_wall_ms{persona:ceo,screen:report,endpoint:dictionaries} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_wall_ms{persona:ceo,screen:report,endpoint:shell-alerts} | p95 (med) | 2.9 (2.5) | 4.5 (3.2) | +53.0 |  |
| req_wall_ms{persona:ceo,screen:report,endpoint:shell-bell} | p95 (med) | 4.6 (4.1) | 5.7 (5.3) | +24.2 |  |
| req_wall_ms{persona:ceo,screen:report,endpoint:shell-probe} | p95 (med) | 3.3 (2.7) | 4.6 (3.8) | +39.9 |  |
| req_wall_ms{persona:ceo,screen:report,endpoint:shell-user} | p95 (med) | 5.4 (4.9) | 6.6 (5.1) | +22.7 |  |
| req_wall_ms{persona:ceo,screen:report,endpoint:users} | p95 (med) | 12.4 (9.5) | 9.3 (8.0) | -25.2 | improved |
| screen_db_ms{persona:ceo,screen:own} | p95 (med) | 29.8 (24.2) | 38.9 (23) | +30.7 | REGRESSED |
| screen_db_ms{persona:ceo,screen:report} | p95 (med) | 107.2 (99.2) | 59.6 (59.5) | -44.4 | improved |
| screen_requests{persona:ceo,screen:own} | median | 5 | 5 | +0.0 |  |
| screen_requests{persona:ceo,screen:report} | median | 11 | 6 | -45.5 | CHANGED |
| screen_seq_ms{persona:ceo,screen:own} | p95 (med) | 37.4 (31.8) | 50.4 (32.6) | +34.8 | REGRESSED |
| screen_seq_ms{persona:ceo,screen:report} | p95 (med) | 121.5 (111.8) | 73.5 (73.3) | -39.5 | improved |
| screen_stmt{persona:ceo,screen:own} | median | 25 | 28 | +12.0 | CHANGED |
| screen_stmt{persona:ceo,screen:report} | median | 99 | 41 | -58.6 | CHANGED |
| screen_tx{persona:ceo,screen:own} | median | 12 | 12 | +0.0 |  |
| screen_tx{persona:ceo,screen:report} | median | 25 | 15 | -40.0 | CHANGED |
| screen_wall_ms{persona:ceo,screen:own} | p95 (med) | 22.4 (17) | 20.5 (16) | -8.5 |  |
| screen_wall_ms{persona:ceo,screen:report} | p95 (med) | 101.8 (91) | 48.9 (48) | -52.0 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT COUNT(*) FROM (SELECT 'FEEDBACK' area, 'EVENT' source, feedback_events.id event_id,` | - | 3 | - | - | 33.5 | NEW |
| `SELECT COUNT(*) FROM (SELECT $1 area, $2 source, feedback_events.id event_id, feedback_eve` | 3 | - | - | 30.5 | - | GONE |
| `SELECT 'FEEDBACK' area, 'EVENT' source, feedback_events.id event_id, feedback_events.feedb` | - | 3 | - | - | 29.8 | NEW |
| `SELECT $1 area, $2 source, feedback_events.id event_id, feedback_events.feedback_id docume` | 3 | - | - | 23.6 | - | GONE |
| `SELECT COUNT(*) FROM (SELECT $1 area, $2 source, feedback_events.id event_id, feedback_eve` | 3 | - | - | 12.5 | - | GONE |
| `SELECT 'FEEDBACK' area, 'EVENT' source, feedback_events.id event_id, feedback_events.feedb` | - | 3 | - | - | 6.4 | NEW |
| `SELECT $1 area, $2 source, feedback_events.id event_id, feedback_events.feedback_id docume` | 3 | - | - | 5.9 | - | GONE |
| `SELECT COUNT(*) FROM (SELECT 'FEEDBACK' area, 'EVENT' source, feedback_events.id event_id,` | - | 3 | - | - | 5 | NEW |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | - | - | 3.1 | - | GONE |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 6 | 6 | +0.0 | 2 | 2.8 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 141 | 66 | improved |
| team_members | 73 | 27 | improved |
| revoked_tokens | 48 | 33 | improved |
| user_roles | 32 | 17 | improved |
| users | 27 | 0 | improved |
| dictionary_entries | 24 | 9 | improved |
| user_disabled_features | 15 | 0 | improved |
| alerts | 6 | 6 |  |
| feedback_subjects | 6 | 6 |  |
| feedbacks | 6 | 6 |  |
| team_kpis | 6 | 6 |  |
| login_lockouts | 4 | 4 |  |

## activity-log.hr.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:hr,screen:audit,endpoint:activity} | median | 6 | 8 | +33.3 | CHANGED |
| req_stmt{persona:hr,screen:audit,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_stmt{persona:hr,screen:audit,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:audit,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:audit,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:audit,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:audit,endpoint:users} | median | 8 | 8 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:activity} | median | 7 | 7 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_tx{persona:hr,screen:audit,endpoint:activity} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:audit,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:hr,screen:audit,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:audit,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:audit,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:audit,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:audit,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:activity} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_wall_ms{persona:hr,screen:audit,endpoint:activity} | p95 (med) | 13.6 (13.5) | 9.9 (9.5) | -27.0 | improved |
| req_wall_ms{persona:hr,screen:audit,endpoint:dictionaries} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_wall_ms{persona:hr,screen:audit,endpoint:shell-alerts} | p95 (med) | 2.7 (2.2) | 2.6 (2.2) | -3.5 |  |
| req_wall_ms{persona:hr,screen:audit,endpoint:shell-bell} | p95 (med) | 2.7 (2.4) | 2.9 (2.8) | +6.0 |  |
| req_wall_ms{persona:hr,screen:audit,endpoint:shell-probe} | p95 (med) | 2.8 (2.6) | 2.9 (2.6) | +4.0 |  |
| req_wall_ms{persona:hr,screen:audit,endpoint:shell-user} | p95 (med) | 7.1 (4.4) | 3.9 (3.8) | -44.7 | improved |
| req_wall_ms{persona:hr,screen:audit,endpoint:users} | p95 (med) | 11.8 (6.1) | 5.1 (4.1) | -57.0 | improved |
| req_wall_ms{persona:hr,screen:own,endpoint:activity} | p95 (med) | 7.8 (6.6) | 6.0 (4.7) | -23.0 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:dictionaries} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-alerts} | p95 (med) | 2.7 (2.5) | 3.2 (2.5) | +19.9 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-bell} | p95 (med) | 3.3 (2.7) | 3.5 (2.8) | +8.0 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-probe} | p95 (med) | 2.8 (2.6) | 3.0 (2.8) | +8.1 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-user} | p95 (med) | 4.3 (3.1) | 4.7 (3.3) | +9.3 |  |
| screen_db_ms{persona:hr,screen:audit} | p95 (med) | 53.7 (53.4) | 18.8 (17.5) | -65.0 | improved |
| screen_db_ms{persona:hr,screen:own} | p95 (med) | 13.6 (11.4) | 11.4 (9.7) | -15.9 | improved |
| screen_requests{persona:hr,screen:audit} | median | 11 | 6 | -45.5 | CHANGED |
| screen_requests{persona:hr,screen:own} | median | 5 | 5 | +0.0 |  |
| screen_seq_ms{persona:hr,screen:audit} | p95 (med) | 67.1 (65.8) | 26.2 (25.8) | -60.9 | improved |
| screen_seq_ms{persona:hr,screen:own} | p95 (med) | 20.8 (17.5) | 20.4 (15.7) | -1.9 |  |
| screen_stmt{persona:hr,screen:audit} | median | 67 | 29 | -56.7 | CHANGED |
| screen_stmt{persona:hr,screen:own} | median | 20 | 20 | +0.0 |  |
| screen_tx{persona:hr,screen:audit} | median | 24 | 14 | -41.7 | CHANGED |
| screen_tx{persona:hr,screen:own} | median | 12 | 12 | +0.0 |  |
| screen_wall_ms{persona:hr,screen:audit} | p95 (med) | 47.8 (46) | 11 (11) | -77.0 | improved |
| screen_wall_ms{persona:hr,screen:own} | p95 (med) | 8.8 (7) | 6.8 (5) | -22.7 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT 'FEEDBACK' area, 'EVENT' source, feedback_events.id event_id, feedback_events.feedb` | 6 | - | - | 7.4 | - | GONE |
| `SELECT $1 area, $2 source, feedback_events.id event_id, feedback_events.feedback_id docume` | - | 6 | - | - | 6.3 | NEW |
| `SELECT COUNT(*) FROM (SELECT 'FEEDBACK' area, 'EVENT' source, feedback_events.id event_id,` | 6 | - | - | 4.9 | - | GONE |
| `SELECT COUNT(*) FROM (SELECT $1 area, $2 source, feedback_events.id event_id, feedback_eve` | - | 6 | - | - | 4.9 | NEW |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | - | - | 2.1 | - | GONE |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 18 | - | - | 0.9 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 15 | - | - | 0.8 | - | GONE |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 18 | - | - | 0.6 | - | GONE |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 15 | - | - | 0.6 | - | GONE |
| `SELECT dictionary_entries.id, dictionary_entries."dictionary", dictionary_entries."positio` | 18 | - | - | 0.3 | - | GONE |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| revoked_tokens | 48 | 33 | improved |
| teams | 33 | 18 | improved |
| user_roles | 33 | 18 | improved |
| users | 27 | 0 | improved |
| dictionary_entries | 18 | 3 | improved |
| user_disabled_features | 15 | 0 | improved |
| alerts | 6 | 6 |  |
| login_lockouts | 6 | 6 |  |

## activity-log.lead.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:lead,screen:own,endpoint:activity} | median | 9 | 10 | +11.1 | CHANGED |
| req_stmt{persona:lead,screen:own,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_stmt{persona:lead,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,screen:own,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:lead,screen:own,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:lead,screen:own,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:lead,screen:report,endpoint:activity} | median | 9 | 10 | +11.1 | CHANGED |
| req_stmt{persona:lead,screen:report,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_stmt{persona:lead,screen:report,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,screen:report,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:lead,screen:report,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:lead,screen:report,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:lead,screen:report,endpoint:users} | median | 10 | 10 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:activity} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:report,endpoint:activity} | median | 4 | 4 | +0.0 |  |
| req_tx{persona:lead,screen:report,endpoint:dictionaries} | median | 0 | 0 | +0.0 |  |
| req_tx{persona:lead,screen:report,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:report,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:report,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:report,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:report,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:activity} | p95 (med) | 18.5 (10.9) | 13.0 (12.1) | -30.0 | improved |
| req_wall_ms{persona:lead,screen:own,endpoint:dictionaries} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-alerts} | p95 (med) | 3.8 (3.8) | 8.0 (7.5) | +107.6 | REGRESSED |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-bell} | p95 (med) | 5.8 (4.6) | 7.5 (4.3) | +29.9 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-probe} | p95 (med) | 4.5 (4.2) | 7.1 (4.6) | +56.2 | REGRESSED |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-user} | p95 (med) | 6.0 (4.6) | 8.6 (8.6) | +42.4 | REGRESSED |
| req_wall_ms{persona:lead,screen:report,endpoint:activity} | p95 (med) | 27.0 (26.9) | 23.4 (21.7) | -13.3 | improved |
| req_wall_ms{persona:lead,screen:report,endpoint:dictionaries} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| req_wall_ms{persona:lead,screen:report,endpoint:shell-alerts} | p95 (med) | 3.5 (2.6) | 2.4 (2.2) | -31.9 |  |
| req_wall_ms{persona:lead,screen:report,endpoint:shell-bell} | p95 (med) | 4.8 (4.6) | 3.6 (3.4) | -24.7 |  |
| req_wall_ms{persona:lead,screen:report,endpoint:shell-probe} | p95 (med) | 4.1 (2.7) | 3.1 (2.8) | -23.1 |  |
| req_wall_ms{persona:lead,screen:report,endpoint:shell-user} | p95 (med) | 6.1 (5.6) | 7.1 (3.8) | +16.0 |  |
| req_wall_ms{persona:lead,screen:report,endpoint:users} | p95 (med) | 9.9 (6.6) | 4.6 (4.4) | -53.0 | improved |
| screen_db_ms{persona:lead,screen:own} | p95 (med) | 28.0 (19.6) | 32.6 (20.5) | +16.7 | REGRESSED |
| screen_db_ms{persona:lead,screen:report} | p95 (med) | 73.9 (73.2) | 35.7 (31.7) | -51.8 | improved |
| screen_requests{persona:lead,screen:own} | median | 5 | 5 | +0.0 |  |
| screen_requests{persona:lead,screen:report} | median | 11 | 6 | -45.5 | CHANGED |
| screen_seq_ms{persona:lead,screen:own} | p95 (med) | 38.7 (27.7) | 43.4 (33.7) | +11.9 | REGRESSED |
| screen_seq_ms{persona:lead,screen:report} | p95 (med) | 86.2 (85.6) | 42.5 (39.1) | -50.7 | improved |
| screen_stmt{persona:lead,screen:own} | median | 23 | 25 | +8.7 | CHANGED |
| screen_stmt{persona:lead,screen:report} | median | 83 | 35 | -57.8 | CHANGED |
| screen_tx{persona:lead,screen:own} | median | 12 | 12 | +0.0 |  |
| screen_tx{persona:lead,screen:report} | median | 25 | 15 | -40.0 | CHANGED |
| screen_wall_ms{persona:lead,screen:own} | p95 (med) | 19.1 (11) | 13 (13) | -31.9 | improved |
| screen_wall_ms{persona:lead,screen:report} | p95 (med) | 67.8 (66) | 24.7 (22) | -63.6 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT COUNT(*) FROM (SELECT 'FEEDBACK' area, 'EVENT' source, feedback_events.id event_id,` | 3 | 3 | +0.0 | 22.7 | 19.5 |  |
| `SELECT 'FEEDBACK' area, 'EVENT' source, feedback_events.id event_id, feedback_events.feedb` | 3 | 3 | +0.0 | 16.5 | 15.1 |  |
| `SELECT COUNT(*) FROM (SELECT 'FEEDBACK' area, 'EVENT' source, feedback_events.id event_id,` | 3 | 3 | +0.0 | 10 | 3.9 |  |
| `SELECT 'FEEDBACK' area, 'EVENT' source, feedback_events.id event_id, feedback_events.feedb` | 3 | 3 | +0.0 | 4.9 | 4.7 |  |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 6 | 6 | +0.0 | 3 | 2.8 |  |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 6 | 6 | +0.0 | 2.4 | 2.3 |  |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | - | - | 2.4 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 15 | - | - | 0.9 | - | GONE |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 18 | - | - | 0.8 | - | GONE |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 18 | - | - | 0.6 | - | GONE |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 93 | 48 | improved |
| revoked_tokens | 48 | 33 | improved |
| user_roles | 33 | 18 | improved |
| users | 27 | 0 | improved |
| team_members | 25 | 9 | improved |
| dictionary_entries | 24 | 9 | improved |
| user_disabled_features | 15 | 0 | improved |
| alerts | 6 | 6 |  |
| feedbacks | 6 | 6 |  |
| login_lockouts | 6 | 6 |  |
| team_kpis | 6 | 6 |  |

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
| req_wall_ms{persona:ceo,screen:first-load,endpoint:managers} | p95 (med) | 4.9 (4.0) | 3.8 (3.7) | -22.8 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:shell-alerts} | p95 (med) | 3.3 (3.2) | 2.8 (2.3) | -16.6 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:shell-bell} | p95 (med) | 4.5 (4.4) | 5.8 (3.9) | +30.1 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:shell-probe} | p95 (med) | 3.7 (2.9) | 5.5 (3.9) | +49.5 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:shell-user} | p95 (med) | 4.8 (4.5) | 5.7 (3.1) | +19.3 |  |
| req_wall_ms{persona:ceo,screen:first-load,endpoint:summary} | p95 (med) | 41.2 (27.2) | 18.3 (17.0) | -55.5 | improved |
| req_wall_ms{persona:ceo,screen:my-teams-tab,endpoint:teams-managed} | p95 (med) | 2.3 (2.1) | 1.7 (1.5) | -27.6 |  |
| req_wall_ms{persona:ceo,screen:peers-tab,endpoint:members-member} | p95 (med) | 3.0 (2.9) | 3.2 (2.7) | +5.1 |  |
| req_wall_ms{persona:ceo,screen:peers-tab,endpoint:teams-all} | p95 (med) | 3.2 (3.1) | 4.0 (2.9) | +24.8 |  |
| req_wall_ms{persona:ceo,screen:subordinates-all,endpoint:members-managed} | p95 (med) | 36.6 (34.7) | 13.3 (11.4) | -63.6 | improved |
| req_wall_ms{persona:ceo,screen:subordinates-all,endpoint:succession-own} | p95 (med) | 6.5 (3.6) | 2.9 (2.8) | -55.4 | improved |
| req_wall_ms{persona:ceo,screen:subordinates-all,endpoint:teams-all} | p95 (med) | 6.2 (2.8) | 4.0 (3.0) | -35.8 | improved |
| req_wall_ms{persona:ceo,screen:subordinates-tab,endpoint:members-managed} | p95 (med) | 21.5 (20.3) | 9.5 (9.4) | -56.0 | improved |
| req_wall_ms{persona:ceo,screen:subordinates-tab,endpoint:succession-own} | p95 (med) | 3.2 (3.2) | 3.5 (2.5) | +9.8 |  |
| req_wall_ms{persona:ceo,screen:subordinates-tab,endpoint:teams-all} | p95 (med) | 3.1 (3.0) | 4.0 (3.0) | +27.1 |  |
| screen_db_ms{persona:ceo,screen:first-load} | p95 (med) | 50.6 (37.4) | 26.1 (24.3) | -48.4 | improved |
| screen_db_ms{persona:ceo,screen:my-teams-tab} | p95 (med) | 1.4 (1.3) | 1.1 (0.9) | -22.3 |  |
| screen_db_ms{persona:ceo,screen:peers-tab} | p95 (med) | 4.2 (4) | 3.3 (3.2) | -21.3 |  |
| screen_db_ms{persona:ceo,screen:subordinates-all} | p95 (med) | 44.7 (36.2) | 15.3 (14.8) | -65.7 | improved |
| screen_db_ms{persona:ceo,screen:subordinates-tab} | p95 (med) | 23.2 (22.3) | 13.1 (11.1) | -43.6 | improved |
| screen_requests{persona:ceo,screen:first-load} | median | 6 | 6 | +0.0 |  |
| screen_requests{persona:ceo,screen:my-teams-tab} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:ceo,screen:peers-tab} | median | 2 | 2 | +0.0 |  |
| screen_requests{persona:ceo,screen:subordinates-all} | median | 3 | 3 | +0.0 |  |
| screen_requests{persona:ceo,screen:subordinates-tab} | median | 3 | 3 | +0.0 |  |
| screen_seq_ms{persona:ceo,screen:first-load} | p95 (med) | 60.4 (48.6) | 40.7 (35.5) | -32.6 | improved |
| screen_seq_ms{persona:ceo,screen:my-teams-tab} | p95 (med) | 2.3 (2.1) | 1.7 (1.5) | -27.6 |  |
| screen_seq_ms{persona:ceo,screen:peers-tab} | p95 (med) | 6.1 (5.8) | 7.1 (5.6) | +17.9 |  |
| screen_seq_ms{persona:ceo,screen:subordinates-all} | p95 (med) | 49.3 (40.8) | 19.2 (18.4) | -61.1 | improved |
| screen_seq_ms{persona:ceo,screen:subordinates-tab} | p95 (med) | 27.7 (26.6) | 16.9 (14.8) | -39.2 | improved |
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
| screen_wall_ms{persona:ceo,screen:first-load} | p95 (med) | 41.5 (28) | 22.6 (19) | -45.5 | improved |
| screen_wall_ms{persona:ceo,screen:my-teams-tab} | p95 (med) | 2.9 (2) | 1.9 (1) | -34.5 |  |
| screen_wall_ms{persona:ceo,screen:peers-tab} | p95 (med) | 4 (4) | 3.9 (3) | -2.5 |  |
| screen_wall_ms{persona:ceo,screen:subordinates-all} | p95 (med) | 36.8 (35) | 16.7 (14) | -54.6 | improved |
| screen_wall_ms{persona:ceo,screen:subordinates-tab} | p95 (med) | 21.9 (21) | 10 (10) | -54.3 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT feedbacks.id, feedbacks.last_modified FROM feedbacks WHERE ((feedbacks.subject_id =` | 6 | 6 | +0.0 | 26.3 | 22 |  |
| `SELECT goals.id, goals.manager_id, goals.subordinate_id, goals.title, goals."type", goals.` | 3 | 3 | +0.0 | 17.7 | 0 |  |
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 90 | - | - | 8.4 | - | GONE |
| `SELECT performance_reviews.id, performance_reviews.manager_id, performance_reviews.subordi` | 3 | 3 | +0.0 | 6.6 | 2.6 |  |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 3 | 3 | +0.0 | 1.6 | 1.4 |  |
| `SELECT performance_reviews.id, review_periods.start_month, review_periods.end_month, perfo` | 90 | - | - | 1.6 | - | GONE |
| `SELECT team_members.team_id, team_members.user_id FROM team_members WHERE team_members.tea` | - | 9 | - | - | 1.4 | NEW |
| `SELECT feedback_events.feedback_id, feedback_events.created_at, feedback_events.event_type` | 18 | 18 | +0.0 | 1.3 | 1 |  |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 3 | 3 | +0.0 | 1.1 | 1.1 |  |
| `SELECT goals.subordinate_id, COUNT(goals.id) FROM goals WHERE (goals.manager_id = $1) AND ` | 6 | 3 | -50.0 | 1 | 0.5 | CHANGED |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 1519 | 68 | improved |
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

## days-off.hr.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:hr,screen:calendar,endpoint:calendar} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:hr,screen:calendar,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:calendar,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:calendar,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:calendar,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:calendar-org,endpoint:calendar} | median | 7 | 7 | +0.0 |  |
| req_stmt{persona:hr,screen:calendar-org,endpoint:teams-all} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:hr,screen:calendar-shared,endpoint:calendar} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:budgets} | median | 7 | 7 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:corrections} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:entries} | median | 4 | 4 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:pool-types} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:users} | median | 8 | 8 | +0.0 |  |
| req_stmt{persona:hr,screen:requests,endpoint:budgets} | median | 7 | 7 | +0.0 |  |
| req_stmt{persona:hr,screen:requests,endpoint:entries} | median | 4 | 4 | +0.0 |  |
| req_stmt{persona:hr,screen:requests,endpoint:pool-types} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:calendar,endpoint:calendar} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:calendar,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:calendar,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:calendar,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:calendar,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:calendar-org,endpoint:calendar} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:calendar-org,endpoint:teams-all} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:calendar-shared,endpoint:calendar} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:budgets} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:corrections} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:entries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:pool-types} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:requests,endpoint:budgets} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:requests,endpoint:entries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:requests,endpoint:pool-types} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:hr,screen:calendar,endpoint:calendar} | p95 (med) | 3.6 (3.3) | 4.7 (3.0) | +31.9 |  |
| req_wall_ms{persona:hr,screen:calendar,endpoint:shell-alerts} | p95 (med) | 2.6 (2.5) | 3.3 (2.1) | +28.3 |  |
| req_wall_ms{persona:hr,screen:calendar,endpoint:shell-bell} | p95 (med) | 3.2 (2.9) | 3.6 (2.4) | +9.7 |  |
| req_wall_ms{persona:hr,screen:calendar,endpoint:shell-probe} | p95 (med) | 2.8 (2.6) | 3.7 (1.9) | +30.0 |  |
| req_wall_ms{persona:hr,screen:calendar,endpoint:shell-user} | p95 (med) | 3.6 (3.6) | 3.9 (2.8) | +7.9 |  |
| req_wall_ms{persona:hr,screen:calendar-org,endpoint:calendar} | p95 (med) | 14.9 (13.3) | 10.0 (8.6) | -32.7 | improved |
| req_wall_ms{persona:hr,screen:calendar-org,endpoint:teams-all} | p95 (med) | 4.2 (2.3) | 3.8 (3.1) | -8.3 |  |
| req_wall_ms{persona:hr,screen:calendar-shared,endpoint:calendar} | p95 (med) | 2.3 (2.0) | 2.0 (1.7) | -13.9 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:budgets} | p95 (med) | 4.4 (4.1) | 8.4 (4.2) | +92.1 | REGRESSED |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:corrections} | p95 (med) | 7.0 (2.4) | 2.5 (2.1) | -63.5 | improved |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:entries} | p95 (med) | 7.2 (3.0) | 3.4 (3.1) | -52.8 | improved |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:pool-types} | p95 (med) | 2.2 (2.0) | 2.3 (1.8) | +6.0 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | p95 (med) | 3.0 (2.8) | 5.8 (2.2) | +94.2 | REGRESSED |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | p95 (med) | 3.4 (3.1) | 6.6 (2.5) | +95.9 | REGRESSED |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | p95 (med) | 3.1 (2.9) | 6.1 (2.6) | +100.2 | REGRESSED |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-user} | p95 (med) | 4.1 (3.6) | 7.4 (3.3) | +80.5 | REGRESSED |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:users} | p95 (med) | 9.2 (6.2) | 8.7 (4.1) | -5.4 |  |
| req_wall_ms{persona:hr,screen:requests,endpoint:budgets} | p95 (med) | 3.5 (3.2) | 3.5 (3.3) | +1.3 |  |
| req_wall_ms{persona:hr,screen:requests,endpoint:entries} | p95 (med) | 2.7 (2.5) | 2.8 (2.2) | +5.5 |  |
| req_wall_ms{persona:hr,screen:requests,endpoint:pool-types} | p95 (med) | 2.3 (2.3) | 2.5 (2.1) | +8.4 |  |
| screen_db_ms{persona:hr,screen:calendar-org} | p95 (med) | 16.0 (12.8) | 11.6 (9) | -27.6 | improved |
| screen_db_ms{persona:hr,screen:calendar-shared} | p95 (med) | 1.4 (1.1) | 1.2 (0.9) | -14.6 |  |
| screen_db_ms{persona:hr,screen:calendar} | p95 (med) | 10.0 (9.6) | 9.6 (6.9) | -4.5 |  |
| screen_db_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 56.8 (49.6) | 28.4 (15.8) | -50.0 | improved |
| screen_db_ms{persona:hr,screen:requests} | p95 (med) | 5.9 (5) | 5.8 (5) | -1.5 |  |
| screen_requests{persona:hr,screen:calendar-org} | median | 2 | 2 | +0.0 |  |
| screen_requests{persona:hr,screen:calendar-shared} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:hr,screen:calendar} | median | 5 | 5 | +0.0 |  |
| screen_requests{persona:hr,screen:drilldown-audit} | median | 14 | 9 | -35.7 | CHANGED |
| screen_requests{persona:hr,screen:requests} | median | 3 | 3 | +0.0 |  |
| screen_seq_ms{persona:hr,screen:calendar-org} | p95 (med) | 19.1 (15.5) | 13.8 (11.7) | -27.3 | improved |
| screen_seq_ms{persona:hr,screen:calendar-shared} | p95 (med) | 2.3 (2.0) | 2.0 (1.7) | -13.9 |  |
| screen_seq_ms{persona:hr,screen:calendar} | p95 (med) | 15.3 (15.1) | 19.1 (11.8) | +25.2 | REGRESSED |
| screen_seq_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 73.6 (65.2) | 51.2 (24.9) | -30.4 | improved |
| screen_seq_ms{persona:hr,screen:requests} | p95 (med) | 8.5 (7.9) | 8.8 (6.9) | +3.9 |  |
| screen_stmt{persona:hr,screen:calendar-org} | median | 10 | 11 | +10.0 | CHANGED |
| screen_stmt{persona:hr,screen:calendar-shared} | median | 3 | 3 | +0.0 |  |
| screen_stmt{persona:hr,screen:calendar} | median | 19 | 19 | +0.0 |  |
| screen_stmt{persona:hr,screen:drilldown-audit} | median | 76 | 36 | -52.6 | CHANGED |
| screen_stmt{persona:hr,screen:requests} | median | 13 | 13 | +0.0 |  |
| screen_tx{persona:hr,screen:calendar-org} | median | 4 | 4 | +0.0 |  |
| screen_tx{persona:hr,screen:calendar-shared} | median | 3 | 3 | +0.0 |  |
| screen_tx{persona:hr,screen:calendar} | median | 11 | 11 | +0.0 |  |
| screen_tx{persona:hr,screen:drilldown-audit} | median | 29 | 19 | -34.5 | CHANGED |
| screen_tx{persona:hr,screen:requests} | median | 6 | 6 | +0.0 |  |
| screen_wall_ms{persona:hr,screen:calendar-org} | p95 (med) | 14.8 (13) | 10.7 (8) | -27.7 | improved |
| screen_wall_ms{persona:hr,screen:calendar-shared} | p95 (med) | 2 (2) | 2 (2) | +0.0 |  |
| screen_wall_ms{persona:hr,screen:calendar} | p95 (med) | 4.9 (4) | 5.7 (3) | +16.3 |  |
| screen_wall_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 50.5 (46) | 10.5 (6) | -79.2 | improved |
| screen_wall_ms{persona:hr,screen:requests} | p95 (med) | 3 (3) | 4.9 (4) | +63.3 |  |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT days_off_requests.user_id FROM days_off_requests WHERE (days_off_requests.marked_as` | 3 | 3 | +0.0 | 2.3 | 2.2 |  |
| `SELECT days_off_requests.id, days_off_requests.user_id, days_off_requests."type", days_off` | 3 | 3 | +0.0 | 1.7 | 1.8 |  |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | - | - | 1.8 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name" FROM team_members INNER JOIN teams ON ` | 3 | 3 | +0.0 | 1.3 | 0.6 |  |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 18 | - | - | 0.9 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 15 | - | - | 0.8 | - | GONE |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 15 | - | - | 0.6 | - | GONE |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 18 | - | - | 0.6 | - | GONE |
| `SELECT days_off_pool_types.id, days_off_pool_types."name", days_off_pool_types.carries_ove` | 6 | 6 | +0.0 | 0.1 | 0.4 |  |
| `SELECT users.id, users."name", users.marked_as_deleted FROM users WHERE users.id IN ($1, $` | 3 | 3 | +0.0 | 0.4 | 0.4 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| revoked_tokens | 75 | 60 | improved |
| teams | 54 | 39 | improved |
| users | 30 | 3 | improved |
| user_roles | 26 | 11 | improved |
| days_off_pool_types | 24 | 24 |  |
| dictionary_entries | 18 | 3 | improved |
| user_disabled_features | 15 | 0 | improved |
| days_off_corrections | 9 | 9 |  |
| public_holidays | 9 | 9 |  |
| team_members | 8 | 9 | MORE SEQ SCANS |
| alerts | 6 | 6 |  |
| login_lockouts | 4 | 4 |  |
| days_off_requests | 3 | 3 |  |

## days-off.lead.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:lead,screen:calendar,endpoint:calendar} | median | 8 | 8 | +0.0 |  |
| req_stmt{persona:lead,screen:calendar,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,screen:calendar,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:lead,screen:calendar,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:lead,screen:calendar,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:lead,screen:calendar-managed,endpoint:calendar} | median | 7 | 7 | +0.0 |  |
| req_stmt{persona:lead,screen:calendar-shared,endpoint:calendar} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:budgets} | median | 11 | 11 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:entries} | median | 7 | 7 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:pool-types} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:users} | median | 10 | 10 | +0.0 |  |
| req_stmt{persona:lead,screen:requests,endpoint:budgets} | median | 7 | 7 | +0.0 |  |
| req_stmt{persona:lead,screen:requests,endpoint:entries} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:lead,screen:requests,endpoint:pool-types} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,screen:team-budgets,endpoint:budgets} | median | 10 | 10 | +0.0 |  |
| req_stmt{persona:lead,screen:team-requests,endpoint:entries} | median | 8 | 8 | +0.0 |  |
| req_stmt{persona:lead,screen:team-requests,endpoint:pool-types} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:calendar,endpoint:calendar} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:calendar,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:calendar,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:calendar,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:calendar,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:calendar-managed,endpoint:calendar} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:calendar-shared,endpoint:calendar} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:budgets} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:entries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:pool-types} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:requests,endpoint:budgets} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:requests,endpoint:entries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:requests,endpoint:pool-types} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:team-budgets,endpoint:budgets} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:team-requests,endpoint:entries} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:team-requests,endpoint:pool-types} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:lead,screen:calendar,endpoint:calendar} | p95 (med) | 5.4 (5.1) | 6.4 (4.0) | +18.1 |  |
| req_wall_ms{persona:lead,screen:calendar,endpoint:shell-alerts} | p95 (med) | 2.6 (1.9) | 3.6 (2.5) | +36.0 |  |
| req_wall_ms{persona:lead,screen:calendar,endpoint:shell-bell} | p95 (med) | 3.9 (3.3) | 4.4 (3.2) | +14.8 |  |
| req_wall_ms{persona:lead,screen:calendar,endpoint:shell-probe} | p95 (med) | 2.9 (2.7) | 4.3 (3.5) | +50.9 |  |
| req_wall_ms{persona:lead,screen:calendar,endpoint:shell-user} | p95 (med) | 4.5 (3.2) | 5.3 (3.7) | +17.0 |  |
| req_wall_ms{persona:lead,screen:calendar-managed,endpoint:calendar} | p95 (med) | 3.9 (2.5) | 3.0 (2.6) | -20.9 |  |
| req_wall_ms{persona:lead,screen:calendar-shared,endpoint:calendar} | p95 (med) | 2.5 (2.0) | 2.1 (1.7) | -15.1 |  |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:budgets} | p95 (med) | 8.7 (7.1) | 5.8 (5.1) | -32.7 | improved |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:entries} | p95 (med) | 7.0 (4.8) | 4.2 (3.7) | -40.2 | improved |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:pool-types} | p95 (med) | 2.2 (2.2) | 1.8 (1.7) | -18.8 |  |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-alerts} | p95 (med) | 2.6 (2.5) | 3.1 (2.0) | +18.3 |  |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-bell} | p95 (med) | 3.8 (3.7) | 4.4 (3.4) | +15.4 |  |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-probe} | p95 (med) | 2.8 (2.7) | 3.2 (2.8) | +13.6 |  |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-user} | p95 (med) | 3.7 (3.6) | 4.1 (4.0) | +8.8 |  |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:users} | p95 (med) | 10.4 (6.9) | 4.5 (4.0) | -57.0 | improved |
| req_wall_ms{persona:lead,screen:requests,endpoint:budgets} | p95 (med) | 3.6 (3.3) | 3.7 (2.7) | +3.6 |  |
| req_wall_ms{persona:lead,screen:requests,endpoint:entries} | p95 (med) | 3.2 (3.2) | 3.9 (2.6) | +19.6 |  |
| req_wall_ms{persona:lead,screen:requests,endpoint:pool-types} | p95 (med) | 1.8 (1.6) | 1.8 (1.6) | -1.6 |  |
| req_wall_ms{persona:lead,screen:team-budgets,endpoint:budgets} | p95 (med) | 4.8 (4.4) | 2.9 (2.8) | -40.6 |  |
| req_wall_ms{persona:lead,screen:team-requests,endpoint:entries} | p95 (med) | 3.8 (3.3) | 3.6 (3.0) | -3.9 |  |
| req_wall_ms{persona:lead,screen:team-requests,endpoint:pool-types} | p95 (med) | 1.6 (1.5) | 1.5 (1.2) | -5.0 |  |
| screen_db_ms{persona:lead,screen:calendar-managed} | p95 (med) | 2.6 (1.9) | 1.8 (1.3) | -29.8 |  |
| screen_db_ms{persona:lead,screen:calendar-shared} | p95 (med) | 1.5 (1) | 1.1 (1) | -29.2 |  |
| screen_db_ms{persona:lead,screen:calendar} | p95 (med) | 12.9 (11.3) | 11.8 (11.4) | -8.3 |  |
| screen_db_ms{persona:lead,screen:drilldown} | p95 (med) | 61.0 (54.2) | 20.2 (19.7) | -66.8 | improved |
| screen_db_ms{persona:lead,screen:requests} | p95 (med) | 6.2 (5.5) | 6.2 (4.8) | -1.1 |  |
| screen_db_ms{persona:lead,screen:team-budgets} | p95 (med) | 4.1 (3.5) | 2.2 (2.1) | -47.0 |  |
| screen_db_ms{persona:lead,screen:team-requests} | p95 (med) | 4.0 (3.6) | 3.7 (3) | -6.1 |  |
| screen_requests{persona:lead,screen:calendar-managed} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:lead,screen:calendar-shared} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:lead,screen:calendar} | median | 5 | 5 | +0.0 |  |
| screen_requests{persona:lead,screen:drilldown} | median | 13 | 8 | -38.5 | CHANGED |
| screen_requests{persona:lead,screen:requests} | median | 3 | 3 | +0.0 |  |
| screen_requests{persona:lead,screen:team-budgets} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:lead,screen:team-requests} | median | 2 | 2 | +0.0 |  |
| screen_seq_ms{persona:lead,screen:calendar-managed} | p95 (med) | 3.9 (2.5) | 3.0 (2.6) | -20.9 |  |
| screen_seq_ms{persona:lead,screen:calendar-shared} | p95 (med) | 2.5 (2.0) | 2.1 (1.7) | -15.1 |  |
| screen_seq_ms{persona:lead,screen:calendar} | p95 (med) | 19.3 (16.2) | 22.5 (17.6) | +16.5 | REGRESSED |
| screen_seq_ms{persona:lead,screen:drilldown} | p95 (med) | 75.2 (70.2) | 28.8 (28.2) | -61.7 | improved |
| screen_seq_ms{persona:lead,screen:requests} | p95 (med) | 8.7 (8.1) | 9.4 (6.8) | +8.4 |  |
| screen_seq_ms{persona:lead,screen:team-budgets} | p95 (med) | 4.8 (4.4) | 2.9 (2.8) | -40.6 |  |
| screen_seq_ms{persona:lead,screen:team-requests} | p95 (med) | 5.4 (4.8) | 5.2 (4.3) | -4.2 |  |
| screen_stmt{persona:lead,screen:calendar-managed} | median | 7 | 7 | +0.0 |  |
| screen_stmt{persona:lead,screen:calendar-shared} | median | 3 | 3 | +0.0 |  |
| screen_stmt{persona:lead,screen:calendar} | median | 22 | 23 | +4.5 | CHANGED |
| screen_stmt{persona:lead,screen:drilldown} | median | 94 | 45 | -52.1 | CHANGED |
| screen_stmt{persona:lead,screen:requests} | median | 14 | 14 | +0.0 |  |
| screen_stmt{persona:lead,screen:team-budgets} | median | 10 | 10 | +0.0 |  |
| screen_stmt{persona:lead,screen:team-requests} | median | 10 | 10 | +0.0 |  |
| screen_tx{persona:lead,screen:calendar-managed} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:lead,screen:calendar-shared} | median | 3 | 3 | +0.0 |  |
| screen_tx{persona:lead,screen:calendar} | median | 11 | 11 | +0.0 |  |
| screen_tx{persona:lead,screen:drilldown} | median | 28 | 18 | -35.7 | CHANGED |
| screen_tx{persona:lead,screen:requests} | median | 6 | 6 | +0.0 |  |
| screen_tx{persona:lead,screen:team-budgets} | median | 3 | 3 | +0.0 |  |
| screen_tx{persona:lead,screen:team-requests} | median | 4 | 4 | +0.0 |  |
| screen_wall_ms{persona:lead,screen:calendar-managed} | p95 (med) | 3.9 (3) | 2.9 (2) | -25.6 |  |
| screen_wall_ms{persona:lead,screen:calendar-shared} | p95 (med) | 2 (2) | 2.9 (2) | +45.0 |  |
| screen_wall_ms{persona:lead,screen:calendar} | p95 (med) | 6 (6) | 6.9 (6) | +15.0 |  |
| screen_wall_ms{persona:lead,screen:drilldown} | p95 (med) | 51.6 (48) | 7.8 (6) | -84.9 | improved |
| screen_wall_ms{persona:lead,screen:requests} | p95 (med) | 4 (4) | 4.8 (3) | +20.0 |  |
| screen_wall_ms{persona:lead,screen:team-budgets} | p95 (med) | 4.9 (4) | 3 (3) | -38.8 |  |
| screen_wall_ms{persona:lead,screen:team-requests} | p95 (med) | 4.9 (4) | 3.9 (3) | -20.4 |  |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 6 | 6 | +0.0 | 3.1 | 3 |  |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 6 | 6 | +0.0 | 2.4 | 3 |  |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | - | - | 1.7 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 15 | - | - | 0.8 | - | GONE |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 18 | - | - | 0.8 | - | GONE |
| `SELECT days_off_requests.id, days_off_requests.user_id, days_off_requests."type", days_off` | 9 | 9 | +0.0 | 0.6 | 0.7 |  |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 15 | - | - | 0.6 | - | GONE |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 18 | - | - | 0.6 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name" FROM team_members INNER JOIN teams ON ` | 15 | 15 | +0.0 | 0.5 | 0.5 |  |
| `SELECT team_members.user_id FROM team_members INNER JOIN teams ON team_members.team_id = t` | 39 | 24 | -38.5 | 0.4 | 0.3 | CHANGED |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 231 | 186 | improved |
| days_off_pool_types | 114 | 114 |  |
| revoked_tokens | 78 | 63 | improved |
| users | 33 | 6 | improved |
| team_members | 30 | 15 | improved |
| user_roles | 26 | 11 | improved |
| dictionary_entries | 24 | 9 | improved |
| user_disabled_features | 15 | 0 | improved |
| days_off_corrections | 9 | 9 |  |
| public_holidays | 9 | 9 |  |
| alerts | 6 | 6 |  |
| login_lockouts | 4 | 4 |  |
| days_off_pools | 2 | 0 | improved |

## impact-log.hr.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:list} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:users} | median | 8 | 8 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:own} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:list} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:own} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:list} | p95 (med) | 4.4 (4.3) | 4.5 (3.1) | +0.5 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | p95 (med) | 3.2 (3.1) | 2.3 (2.2) | -29.1 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | p95 (med) | 3.8 (3.1) | 4.3 (3.1) | +13.9 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | p95 (med) | 3.3 (3.1) | 3.3 (2.8) | -0.4 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-user} | p95 (med) | 5.3 (4.3) | 4.7 (3.3) | -11.7 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:users} | p95 (med) | 8.6 (7.0) | 4.9 (3.1) | -43.4 | improved |
| req_wall_ms{persona:hr,screen:own,endpoint:own} | p95 (med) | 3.8 (3.1) | 4.7 (2.4) | +24.3 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-alerts} | p95 (med) | 3.0 (2.2) | 4.2 (1.9) | +40.9 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-bell} | p95 (med) | 3.4 (2.6) | 4.6 (2.3) | +34.3 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-probe} | p95 (med) | 3.5 (3.1) | 3.3 (2.0) | -5.4 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-user} | p95 (med) | 3.9 (3.9) | 4.4 (2.7) | +12.4 |  |
| screen_db_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 48.5 (46.2) | 14.7 (11.5) | -69.6 | improved |
| screen_db_ms{persona:hr,screen:own} | p95 (med) | 10.9 (9.3) | 11.9 (6.1) | +9.4 |  |
| screen_requests{persona:hr,screen:drilldown-audit} | median | 11 | 6 | -45.5 | CHANGED |
| screen_requests{persona:hr,screen:own} | median | 5 | 5 | +0.0 |  |
| screen_seq_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 62.6 (58.4) | 23.9 (17.3) | -61.8 | improved |
| screen_seq_ms{persona:hr,screen:own} | p95 (med) | 17.1 (15.4) | 21.1 (11.1) | +23.3 | REGRESSED |
| screen_stmt{persona:hr,screen:drilldown-audit} | median | 64 | 24 | -62.5 | CHANGED |
| screen_stmt{persona:hr,screen:own} | median | 16 | 16 | +0.0 |  |
| screen_tx{persona:hr,screen:drilldown-audit} | median | 23 | 13 | -43.5 | CHANGED |
| screen_tx{persona:hr,screen:own} | median | 11 | 11 | +0.0 |  |
| screen_wall_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 47.8 (46) | 5.8 (4) | -87.9 | improved |
| screen_wall_ms{persona:hr,screen:own} | p95 (med) | 4.9 (4) | 5.7 (3) | +16.3 |  |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | - | - | 1.7 | - | GONE |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 18 | - | - | 0.9 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 15 | - | - | 0.8 | - | GONE |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 18 | - | - | 0.6 | - | GONE |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 15 | - | - | 0.6 | - | GONE |
| `SELECT COUNT(*) FROM impact_log_entries INNER JOIN users ON users.id = impact_log_entries.` | 6 | 6 | +0.0 | 0.3 | 0.2 |  |
| `SELECT revoked_tokens.jti, revoked_tokens.expires_at FROM revoked_tokens WHERE revoked_tok` | 48 | 33 | -31.2 | 0.1 | 0.3 | CHANGED |
| `SELECT dictionary_entries.id, dictionary_entries."dictionary", dictionary_entries."positio` | 18 | - | - | 0.3 | - | GONE |
| `SELECT impact_log_entries.id, impact_log_entries.user_id, impact_log_entries.title, impact` | 6 | 6 | +0.0 | 0.2 | 0.3 |  |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 3 | - | - | 0.2 | - | GONE |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| revoked_tokens | 48 | 33 | improved |
| teams | 30 | 15 | improved |
| users | 27 | 0 | improved |
| user_roles | 26 | 11 | improved |
| dictionary_entries | 18 | 3 | improved |
| user_disabled_features | 15 | 0 | improved |
| alerts | 6 | 6 |  |
| login_lockouts | 4 | 4 |  |
| team_members | 1 | 0 | improved |

## impact-log.lead.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:lead,screen:drilldown,endpoint:list} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:users} | median | 10 | 10 | +0.0 |  |
| req_stmt{persona:lead,screen:managed,endpoint:managed} | median | 4 | 4 | +0.0 |  |
| req_stmt{persona:lead,screen:own,endpoint:own} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:lead,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,screen:own,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:lead,screen:own,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:lead,screen:own,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:list} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:managed,endpoint:managed} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:own} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:list} | p95 (med) | 4.4 (4.4) | 7.4 (4.6) | +68.2 | REGRESSED |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-alerts} | p95 (med) | 2.3 (2.2) | 6.8 (2.5) | +191.6 | REGRESSED |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-bell} | p95 (med) | 4.3 (3.6) | 7.8 (4.5) | +79.6 | REGRESSED |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-probe} | p95 (med) | 2.8 (2.6) | 7.0 (2.9) | +146.4 | REGRESSED |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-user} | p95 (med) | 4.7 (4.1) | 7.6 (4.6) | +59.4 | REGRESSED |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:users} | p95 (med) | 8.3 (7.4) | 8.8 (5.9) | +5.0 |  |
| req_wall_ms{persona:lead,screen:managed,endpoint:managed} | p95 (med) | 4.2 (3.7) | 3.5 (2.9) | -16.0 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:own} | p95 (med) | 5.2 (4.6) | 3.3 (3.0) | -36.6 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-alerts} | p95 (med) | 4.0 (2.9) | 2.2 (2.2) | -44.2 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-bell} | p95 (med) | 5.6 (4.6) | 4.9 (3.8) | -11.0 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-probe} | p95 (med) | 3.5 (3.2) | 4.6 (2.3) | +32.9 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-user} | p95 (med) | 5.7 (4.1) | 3.3 (2.8) | -41.7 | improved |
| screen_db_ms{persona:lead,screen:drilldown} | p95 (med) | 50.5 (47.6) | 30.1 (16.3) | -40.4 | improved |
| screen_db_ms{persona:lead,screen:managed} | p95 (med) | 3.3 (3) | 2.3 (2.2) | -30.0 |  |
| screen_db_ms{persona:lead,screen:own} | p95 (med) | 16.5 (11.8) | 9.3 (8.8) | -43.3 | improved |
| screen_requests{persona:lead,screen:drilldown} | median | 11 | 6 | -45.5 | CHANGED |
| screen_requests{persona:lead,screen:managed} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:lead,screen:own} | median | 5 | 5 | +0.0 |  |
| screen_seq_ms{persona:lead,screen:drilldown} | p95 (med) | 61.9 (59.0) | 45.0 (22.4) | -27.3 | improved |
| screen_seq_ms{persona:lead,screen:managed} | p95 (med) | 4.2 (3.7) | 3.5 (2.9) | -16.0 |  |
| screen_seq_ms{persona:lead,screen:own} | p95 (med) | 23.8 (18.1) | 18.4 (13.9) | -22.9 | improved |
| screen_stmt{persona:lead,screen:drilldown} | median | 79 | 30 | -62.0 | CHANGED |
| screen_stmt{persona:lead,screen:managed} | median | 4 | 4 | +0.0 |  |
| screen_stmt{persona:lead,screen:own} | median | 17 | 18 | +5.9 | CHANGED |
| screen_tx{persona:lead,screen:drilldown} | median | 23 | 13 | -43.5 | CHANGED |
| screen_tx{persona:lead,screen:managed} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:lead,screen:own} | median | 11 | 11 | +0.0 |  |
| screen_wall_ms{persona:lead,screen:drilldown} | p95 (med) | 50 (50) | 9.6 (6) | -80.8 | improved |
| screen_wall_ms{persona:lead,screen:managed} | p95 (med) | 4 (4) | 3 (3) | -25.0 |  |
| screen_wall_ms{persona:lead,screen:own} | p95 (med) | 6.8 (5) | 5.9 (5) | -13.2 |  |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 6 | 6 | +0.0 | 2.6 | 3.1 |  |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 6 | 6 | +0.0 | 2.9 | 2.8 |  |
| `SELECT impact_log_entries.id, impact_log_entries.user_id, impact_log_entries.title, impact` | 3 | - | - | 2.3 | - | GONE |
| `SELECT impact_log_entries.id, impact_log_entries.user_id, impact_log_entries.title, impact` | 3 | 6 | +100.0 | 0.2 | 2 | CHANGED |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | - | - | 1.8 | - | GONE |
| `SELECT COUNT(*) FROM impact_log_entries INNER JOIN users ON users.id = impact_log_entries.` | 3 | - | - | 1 | - | GONE |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 18 | - | - | 0.9 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 15 | - | - | 0.8 | - | GONE |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 18 | - | - | 0.6 | - | GONE |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 15 | - | - | 0.6 | - | GONE |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 75 | 30 | improved |
| revoked_tokens | 51 | 36 | improved |
| users | 30 | 3 | improved |
| user_roles | 26 | 11 | improved |
| dictionary_entries | 24 | 9 | improved |
| team_members | 21 | 6 | improved |
| user_disabled_features | 15 | 0 | improved |
| alerts | 6 | 6 |  |
| login_lockouts | 4 | 4 |  |

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
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:events} | p95 (med) | 5.7 (5.6) | 4.6 (4.4) | -19.4 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:item-history} | p95 (med) | 9.4 (8.5) | 5.3 (4.5) | -43.6 | improved |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:meeting} | p95 (med) | 8.3 (7.7) | 6.2 (5.6) | -25.8 | improved |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:shell-alerts} | p95 (med) | 2.5 (2.5) | 2.6 (2.5) | +0.6 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:shell-bell} | p95 (med) | 4.9 (4.3) | 3.9 (3.4) | -20.0 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:shell-probe} | p95 (med) | 3.5 (3.3) | 3.2 (2.8) | -6.9 |  |
| req_wall_ms{persona:ceo,screen:detail-chain,endpoint:shell-user} | p95 (med) | 4.9 (4.7) | 4.2 (3.7) | -12.9 |  |
| req_wall_ms{persona:ceo,screen:managed,endpoint:managed} | p95 (med) | 8.0 (8.0) | 6.8 (4.7) | -15.3 |  |
| req_wall_ms{persona:ceo,screen:managed-latest,endpoint:managed} | p95 (med) | 49.0 (48.7) | 5.3 (3.4) | -89.1 | improved |
| req_wall_ms{persona:ceo,screen:own,endpoint:own} | p95 (med) | 3.9 (3.3) | 4.8 (2.8) | +23.3 |  |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-alerts} | p95 (med) | 3.9 (2.7) | 3.1 (2.7) | -20.3 |  |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-bell} | p95 (med) | 4.5 (4.4) | 4.7 (3.4) | +4.1 |  |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-probe} | p95 (med) | 3.8 (3.0) | 4.2 (2.6) | +11.0 |  |
| req_wall_ms{persona:ceo,screen:own,endpoint:shell-user} | p95 (med) | 5.1 (4.2) | 3.9 (3.8) | -22.8 |  |
| req_wall_ms{persona:ceo,screen:team,endpoint:team} | p95 (med) | 17.8 (17.5) | 13.4 (13.0) | -25.0 | improved |
| req_wall_ms{persona:ceo,screen:team-all,endpoint:team} | p95 (med) | 44.7 (40.4) | 33.8 (33.6) | -24.4 | improved |
| screen_db_ms{persona:ceo,screen:detail-chain} | p95 (med) | 30.4 (28.5) | 19.6 (19.2) | -35.3 | improved |
| screen_db_ms{persona:ceo,screen:managed-latest} | p95 (med) | 48.3 (48) | 2.9 (2.6) | -94.1 | improved |
| screen_db_ms{persona:ceo,screen:managed} | p95 (med) | 7.3 (7.3) | 5.1 (3.5) | -29.9 | improved |
| screen_db_ms{persona:ceo,screen:own} | p95 (med) | 14.0 (11.3) | 11.8 (8.6) | -15.4 | improved |
| screen_db_ms{persona:ceo,screen:team-all} | p95 (med) | 43.9 (39.6) | 32.8 (32.8) | -25.3 | improved |
| screen_db_ms{persona:ceo,screen:team} | p95 (med) | 17.2 (16.8) | 12.6 (12.3) | -26.7 | improved |
| screen_requests{persona:ceo,screen:detail-chain} | median | 7 | 7 | +0.0 |  |
| screen_requests{persona:ceo,screen:managed-latest} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:ceo,screen:managed} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:ceo,screen:own} | median | 5 | 5 | +0.0 |  |
| screen_requests{persona:ceo,screen:team-all} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:ceo,screen:team} | median | 1 | 1 | +0.0 |  |
| screen_seq_ms{persona:ceo,screen:detail-chain} | p95 (med) | 38.9 (36.2) | 28.2 (27.6) | -27.4 | improved |
| screen_seq_ms{persona:ceo,screen:managed-latest} | p95 (med) | 49.0 (48.7) | 5.3 (3.4) | -89.1 | improved |
| screen_seq_ms{persona:ceo,screen:managed} | p95 (med) | 8.0 (8.0) | 6.8 (4.7) | -15.3 |  |
| screen_seq_ms{persona:ceo,screen:own} | p95 (med) | 21.1 (16.6) | 20.5 (14.5) | -2.7 |  |
| screen_seq_ms{persona:ceo,screen:team-all} | p95 (med) | 44.7 (40.4) | 33.8 (33.6) | -24.4 | improved |
| screen_seq_ms{persona:ceo,screen:team} | p95 (med) | 17.8 (17.5) | 13.4 (13.0) | -25.0 | improved |
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
| screen_wall_ms{persona:ceo,screen:detail-chain} | p95 (med) | 23.9 (23) | 18.7 (16) | -21.8 | improved |
| screen_wall_ms{persona:ceo,screen:managed-latest} | p95 (med) | 49.9 (49) | 4.8 (3) | -90.4 | improved |
| screen_wall_ms{persona:ceo,screen:managed} | p95 (med) | 8 (8) | 7.7 (5) | -3.8 |  |
| screen_wall_ms{persona:ceo,screen:own} | p95 (med) | 5.9 (5) | 8.6 (5) | +45.8 | REGRESSED |
| screen_wall_ms{persona:ceo,screen:team-all} | p95 (med) | 44.5 (40) | 33.9 (33) | -23.8 | improved |
| screen_wall_ms{persona:ceo,screen:team} | p95 (med) | 18 (18) | 13.9 (13) | -22.8 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT one_on_one_meetings.id, one_on_one_meetings.manager_id, one_on_one_meetings.subordi` | 15 | 15 | +0.0 | 191.3 | 66 |  |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 6 | 6 | +0.0 | 37.8 | 34.4 |  |
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 189 | 9 | -95.2 | 21.6 | 0.1 | CHANGED |
| `SELECT DISTINCT ON (one_on_one_meetings.manager_id, one_on_one_meetings.subordinate_id) on` | - | 6 | - | - | 13.1 | NEW |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 6 | 6 | +0.0 | 2.5 | 3.2 |  |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 6 | 6 | +0.0 | 2.4 | 2.2 |  |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 3 | - | - | 2.1 | - | GONE |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 3 | 3 | +0.0 | 1.3 | 0.8 |  |
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 9 | 9 | +0.0 | 1 | 0.1 |  |
| `SELECT one_on_one_notes.meeting_id, one_on_one_notes.kind, COUNT(one_on_one_notes.id) FROM` | 12 | - | - | 0.9 | - | GONE |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 54 | 164 | MORE SEQ SCANS |
| users | 45 | 109 | MORE SEQ SCANS |
| revoked_tokens | 48 | 94 | MORE SEQ SCANS |
| team_members | 9 | 86 | MORE SEQ SCANS |
| review_periods | 0 | 32 | NEW SEQ SCANS |
| days_off_pool_types | 0 | 24 | NEW SEQ SCANS |
| dictionary_entries | 6 | 23 | MORE SEQ SCANS |
| days_off_corrections | 0 | 12 | NEW SEQ SCANS |
| one_on_one_meetings | 12 | 12 |  |
| user_roles | 8 | 10 | MORE SEQ SCANS |
| alerts | 6 | 7 | MORE SEQ SCANS |
| days_off_pools | 0 | 7 | NEW SEQ SCANS |
| login_lockouts | 4 | 6 | MORE SEQ SCANS |
| app_settings | 0 | 2 | NEW SEQ SCANS |
| feedbacks | 0 | 2 | NEW SEQ SCANS |
| pulse_cycles | 0 | 1 | NEW SEQ SCANS |

## one-on-ones.hr.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:list} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:users} | median | 8 | 8 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:own} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:own,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:list} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:own} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:own,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:list} | p95 (med) | 6.5 (5.3) | 5.3 (4.5) | -19.2 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | p95 (med) | 3.1 (2.6) | 2.9 (1.9) | -6.6 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | p95 (med) | 3.1 (2.5) | 3.3 (2.7) | +7.1 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | p95 (med) | 3.4 (3.1) | 3.7 (2.6) | +10.5 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-user} | p95 (med) | 5.8 (3.9) | 3.8 (2.9) | -35.4 | improved |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:users} | p95 (med) | 7.5 (6.2) | 4.3 (3.8) | -42.9 | improved |
| req_wall_ms{persona:hr,screen:own,endpoint:own} | p95 (med) | 3.9 (3.3) | 3.9 (2.9) | -1.0 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-alerts} | p95 (med) | 3.2 (2.4) | 2.9 (2.3) | -9.2 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-bell} | p95 (med) | 3.8 (3.3) | 4.0 (2.8) | +3.1 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-probe} | p95 (med) | 3.5 (2.8) | 2.9 (2.3) | -17.4 |  |
| req_wall_ms{persona:hr,screen:own,endpoint:shell-user} | p95 (med) | 4.4 (3.6) | 3.7 (2.8) | -16.1 |  |
| screen_db_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 45.1 (44.1) | 15.9 (11.8) | -64.6 | improved |
| screen_db_ms{persona:hr,screen:own} | p95 (med) | 13.5 (9.1) | 8.5 (7.5) | -37.2 | improved |
| screen_requests{persona:hr,screen:drilldown-audit} | median | 11 | 6 | -45.5 | CHANGED |
| screen_requests{persona:hr,screen:own} | median | 5 | 5 | +0.0 |  |
| screen_seq_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 56.1 (55.4) | 23.2 (17.8) | -58.6 | improved |
| screen_seq_ms{persona:hr,screen:own} | p95 (med) | 18.9 (15.0) | 17.4 (12.9) | -8.0 |  |
| screen_stmt{persona:hr,screen:drilldown-audit} | median | 67 | 27 | -59.7 | CHANGED |
| screen_stmt{persona:hr,screen:own} | median | 16 | 16 | +0.0 |  |
| screen_tx{persona:hr,screen:drilldown-audit} | median | 23 | 13 | -43.5 | CHANGED |
| screen_tx{persona:hr,screen:own} | median | 11 | 11 | +0.0 |  |
| screen_wall_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 43.9 (43) | 5.9 (5) | -86.6 | improved |
| screen_wall_ms{persona:hr,screen:own} | p95 (med) | 4.9 (4) | 4 (4) | -18.4 |  |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT one_on_one_meetings.id, one_on_one_meetings.manager_id, one_on_one_meetings.subordi` | 6 | 6 | +0.0 | 1.7 | 0.9 |  |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | - | - | 1.6 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 15 | - | - | 1.1 | - | GONE |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 3 | 3 | +0.0 | 1 | 0.9 |  |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 18 | - | - | 0.9 | - | GONE |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 18 | - | - | 0.6 | - | GONE |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 15 | - | - | 0.6 | - | GONE |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 3 | 3 | +0.0 | 0.1 | 0.5 |  |
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 3 | - | - | 0.4 | - | GONE |
| `SELECT dictionary_entries.id, dictionary_entries."dictionary", dictionary_entries."positio` | 18 | - | - | 0.3 | - | GONE |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| revoked_tokens | 48 | 33 | improved |
| users | 33 | 6 | improved |
| teams | 30 | 15 | improved |
| user_roles | 26 | 11 | improved |
| dictionary_entries | 18 | 3 | improved |
| user_disabled_features | 15 | 0 | improved |
| alerts | 6 | 6 |  |
| login_lockouts | 4 | 4 |  |

## one-on-ones.lead.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:lead,screen:drilldown,endpoint:list} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:lead,screen:drilldown,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:lead,screen:drilldown,endpoint:users} | median | 10 | 10 | +0.0 |  |
| req_stmt{persona:lead,screen:managed,endpoint:managed} | median | 12 | 6 | -50.0 | CHANGED |
| req_stmt{persona:lead,screen:managed-latest,endpoint:managed} | median | 12 | 6 | -50.0 | CHANGED |
| req_stmt{persona:lead,screen:own,endpoint:own} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:lead,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:lead,screen:own,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:lead,screen:own,endpoint:shell-probe} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:lead,screen:own,endpoint:shell-user} | median | 6 | 6 | +0.0 |  |
| req_stmt{persona:lead,screen:team,endpoint:team} | median | 4 | 4 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:list} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:drilldown,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:managed,endpoint:managed} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:managed-latest,endpoint:managed} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:own} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:lead,screen:own,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:lead,screen:team,endpoint:team} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:list} | p95 (med) | 10.1 (7.6) | 7.6 (6.6) | -24.6 | improved |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-alerts} | p95 (med) | 2.8 (2.7) | 5.4 (2.1) | +91.5 | REGRESSED |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-bell} | p95 (med) | 4.7 (4.4) | 6.2 (4.8) | +31.9 |  |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-probe} | p95 (med) | 3.6 (3.0) | 5.7 (3.9) | +58.3 | REGRESSED |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:shell-user} | p95 (med) | 4.1 (4.0) | 7.5 (5.3) | +80.6 | REGRESSED |
| req_wall_ms{persona:lead,screen:drilldown,endpoint:users} | p95 (med) | 14.3 (7.8) | 7.3 (5.3) | -49.1 | improved |
| req_wall_ms{persona:lead,screen:managed,endpoint:managed} | p95 (med) | 6.3 (6.1) | 5.6 (4.3) | -11.0 |  |
| req_wall_ms{persona:lead,screen:managed-latest,endpoint:managed} | p95 (med) | 36.6 (36.2) | 4.1 (4.0) | -88.8 | improved |
| req_wall_ms{persona:lead,screen:own,endpoint:own} | p95 (med) | 6.3 (5.6) | 5.4 (4.3) | -13.8 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-alerts} | p95 (med) | 3.0 (2.8) | 2.9 (1.8) | -3.7 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-bell} | p95 (med) | 5.2 (5.1) | 3.8 (3.6) | -26.4 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-probe} | p95 (med) | 3.7 (3.4) | 3.6 (3.4) | -2.0 |  |
| req_wall_ms{persona:lead,screen:own,endpoint:shell-user} | p95 (med) | 5.3 (4.9) | 4.8 (3.9) | -9.1 |  |
| req_wall_ms{persona:lead,screen:team,endpoint:team} | p95 (med) | 2.6 (2.0) | 2.4 (2.2) | -7.9 |  |
| screen_db_ms{persona:lead,screen:drilldown} | p95 (med) | 62.7 (60.0) | 33.3 (19.4) | -47.0 | improved |
| screen_db_ms{persona:lead,screen:managed-latest} | p95 (med) | 36.0 (35.5) | 3.2 (2.9) | -91.2 | improved |
| screen_db_ms{persona:lead,screen:managed} | p95 (med) | 5.7 (5.5) | 4.8 (3.5) | -16.2 |  |
| screen_db_ms{persona:lead,screen:own} | p95 (med) | 16.0 (15.7) | 12.2 (10.9) | -23.9 | improved |
| screen_db_ms{persona:lead,screen:team} | p95 (med) | 1.8 (1.4) | 1.7 (1.4) | -5.1 |  |
| screen_requests{persona:lead,screen:drilldown} | median | 11 | 6 | -45.5 | CHANGED |
| screen_requests{persona:lead,screen:managed-latest} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:lead,screen:managed} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:lead,screen:own} | median | 5 | 5 | +0.0 |  |
| screen_requests{persona:lead,screen:team} | median | 1 | 1 | +0.0 |  |
| screen_seq_ms{persona:lead,screen:drilldown} | p95 (med) | 81.4 (74.3) | 39.7 (28.0) | -51.2 | improved |
| screen_seq_ms{persona:lead,screen:managed-latest} | p95 (med) | 36.6 (36.2) | 4.1 (4.0) | -88.8 | improved |
| screen_seq_ms{persona:lead,screen:managed} | p95 (med) | 6.3 (6.1) | 5.6 (4.3) | -11.0 |  |
| screen_seq_ms{persona:lead,screen:own} | p95 (med) | 22.9 (21.0) | 20.3 (17.1) | -11.3 | improved |
| screen_seq_ms{persona:lead,screen:team} | p95 (med) | 2.6 (2.0) | 2.4 (2.2) | -7.9 |  |
| screen_stmt{persona:lead,screen:drilldown} | median | 80 | 31 | -61.3 | CHANGED |
| screen_stmt{persona:lead,screen:managed-latest} | median | 12 | 6 | -50.0 | CHANGED |
| screen_stmt{persona:lead,screen:managed} | median | 12 | 6 | -50.0 | CHANGED |
| screen_stmt{persona:lead,screen:own} | median | 20 | 21 | +5.0 | CHANGED |
| screen_stmt{persona:lead,screen:team} | median | 4 | 4 | +0.0 |  |
| screen_tx{persona:lead,screen:drilldown} | median | 23 | 13 | -43.5 | CHANGED |
| screen_tx{persona:lead,screen:managed-latest} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:lead,screen:managed} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:lead,screen:own} | median | 11 | 11 | +0.0 |  |
| screen_tx{persona:lead,screen:team} | median | 2 | 2 | +0.0 |  |
| screen_wall_ms{persona:lead,screen:drilldown} | p95 (med) | 66.6 (54) | 8.8 (7) | -86.8 | improved |
| screen_wall_ms{persona:lead,screen:managed-latest} | p95 (med) | 37 (37) | 4.9 (4) | -86.8 | improved |
| screen_wall_ms{persona:lead,screen:managed} | p95 (med) | 6.9 (6) | 5 (5) | -27.5 |  |
| screen_wall_ms{persona:lead,screen:own} | p95 (med) | 6.9 (6) | 6.8 (5) | -1.4 |  |
| screen_wall_ms{persona:lead,screen:team} | p95 (med) | 2 (2) | 2 (2) | +0.0 |  |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT one_on_one_meetings.id, one_on_one_meetings.manager_id, one_on_one_meetings.subordi` | 15 | 15 | +0.0 | 94.6 | 5.0 |  |
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 48 | - | - | 5.2 | - | GONE |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 6 | 6 | +0.0 | 2.6 | 2.9 |  |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 6 | 6 | +0.0 | 2.2 | 2.5 |  |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 3 | - | - | 1.7 | - | GONE |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | - | - | 1.6 | - | GONE |
| `SELECT one_on_one_notes.meeting_id, one_on_one_notes.kind, COUNT(one_on_one_notes.id) FROM` | 12 | - | - | 1.2 | - | GONE |
| `SELECT one_on_one_action_items.meeting_id, one_on_one_action_items.resolved, COUNT(one_on_` | 12 | - | - | 1.2 | - | GONE |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 3 | - | - | 1 | - | GONE |
| `SELECT COUNT(*) FROM one_on_one_meetings INNER JOIN users manager_users ON one_on_one_meet` | 3 | 3 | +0.0 | 0.8 | 0.9 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 69 | 24 | improved |
| revoked_tokens | 57 | 42 | improved |
| users | 36 | 6 | improved |
| user_roles | 26 | 11 | improved |
| dictionary_entries | 24 | 9 | improved |
| team_members | 19 | 3 | improved |
| user_disabled_features | 15 | 0 | improved |
| alerts | 6 | 6 |  |
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
| req_stmt{persona:hr,screen:results,endpoint:comments} | median | 7 | 6 | -14.3 | CHANGED |
| req_stmt{persona:hr,screen:results,endpoint:cycles} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:results} | median | 11 | 9 | -18.2 | CHANGED |
| req_stmt{persona:hr,screen:results,endpoint:shares} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:results,endpoint:trend} | median | 264 | 6 | -97.7 | CHANGED |
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
| req_stmt{persona:hr,screen:trend,endpoint:trend} | median | 264 | 6 | -97.7 | CHANGED |
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
| req_tx{persona:hr,screen:results,endpoint:trend} | median | 263 | 5 | -98.1 | CHANGED |
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
| req_tx{persona:hr,screen:trend,endpoint:trend} | median | 263 | 5 | -98.1 | CHANGED |
| req_tx{persona:hr,screen:trend,endpoint:visible-teams} | median | 8 | 8 | +0.0 |  |
| req_wall_ms{persona:hr,screen:participation,endpoint:cycles} | p95 (med) | 4.2 (3.8) | 2.6 (2.5) | -36.9 |  |
| req_wall_ms{persona:hr,screen:participation,endpoint:participation} | p95 (med) | 10.5 (10.4) | 7.8 (5.8) | -25.4 | improved |
| req_wall_ms{persona:hr,screen:participation,endpoint:shell-alerts} | p95 (med) | 2.1 (2.0) | 1.9 (1.8) | -10.1 |  |
| req_wall_ms{persona:hr,screen:participation,endpoint:shell-bell} | p95 (med) | 2.8 (2.4) | 2.4 (2.2) | -17.0 |  |
| req_wall_ms{persona:hr,screen:participation,endpoint:shell-probe} | p95 (med) | 2.5 (2.5) | 2.1 (2.1) | -16.1 |  |
| req_wall_ms{persona:hr,screen:participation,endpoint:shell-user} | p95 (med) | 3.8 (3.2) | 2.9 (2.9) | -23.3 |  |
| req_wall_ms{persona:hr,screen:results,endpoint:comments} | p95 (med) | 39.0 (6.3) | 32.8 (4.8) | -15.9 | improved |
| req_wall_ms{persona:hr,screen:results,endpoint:cycles} | p95 (med) | 4.3 (4.3) | 6.7 (2.5) | +54.6 | REGRESSED |
| req_wall_ms{persona:hr,screen:results,endpoint:results} | p95 (med) | 52.4 (12.3) | 40.9 (7.1) | -22.0 | improved |
| req_wall_ms{persona:hr,screen:results,endpoint:shares} | p95 (med) | 3.4 (2.8) | 2.3 (2.2) | -31.7 |  |
| req_wall_ms{persona:hr,screen:results,endpoint:shell-alerts} | p95 (med) | 3.0 (1.9) | 6.5 (2.5) | +117.2 | REGRESSED |
| req_wall_ms{persona:hr,screen:results,endpoint:shell-bell} | p95 (med) | 3.4 (2.5) | 7.1 (2.8) | +110.6 | REGRESSED |
| req_wall_ms{persona:hr,screen:results,endpoint:shell-probe} | p95 (med) | 2.8 (2.4) | 6.3 (2.5) | +120.6 | REGRESSED |
| req_wall_ms{persona:hr,screen:results,endpoint:shell-user} | p95 (med) | 3.5 (3.3) | 7.6 (3.3) | +114.7 | REGRESSED |
| req_wall_ms{persona:hr,screen:results,endpoint:trend} | p95 (med) | 465.6 (412.6) | 23.6 (6.2) | -94.9 | improved |
| req_wall_ms{persona:hr,screen:results,endpoint:visible-teams} | p95 (med) | 6.4 (5.9) | 9.0 (5.1) | +40.5 | REGRESSED |
| req_wall_ms{persona:hr,screen:survey,endpoint:cycles} | p95 (med) | 4.6 (3.8) | 3.2 (2.4) | -30.9 |  |
| req_wall_ms{persona:hr,screen:survey,endpoint:my-response} | p95 (med) | 2.5 (2.4) | 6.8 (1.9) | +177.7 | REGRESSED |
| req_wall_ms{persona:hr,screen:survey,endpoint:shell-alerts} | p95 (med) | 3.2 (2.3) | 3.1 (2.0) | -1.6 |  |
| req_wall_ms{persona:hr,screen:survey,endpoint:shell-bell} | p95 (med) | 4.0 (2.6) | 4.2 (1.9) | +5.4 |  |
| req_wall_ms{persona:hr,screen:survey,endpoint:shell-probe} | p95 (med) | 3.0 (2.6) | 3.3 (2.2) | +7.0 |  |
| req_wall_ms{persona:hr,screen:survey,endpoint:shell-user} | p95 (med) | 3.6 (3.4) | 3.9 (2.6) | +9.7 |  |
| req_wall_ms{persona:hr,screen:trend,endpoint:shell-alerts} | p95 (med) | 2.2 (2.0) | 3.0 (2.5) | +41.0 |  |
| req_wall_ms{persona:hr,screen:trend,endpoint:shell-bell} | p95 (med) | 2.5 (2.4) | 3.3 (2.1) | +29.7 |  |
| req_wall_ms{persona:hr,screen:trend,endpoint:shell-probe} | p95 (med) | 2.3 (2.2) | 3.1 (2.2) | +35.3 |  |
| req_wall_ms{persona:hr,screen:trend,endpoint:shell-user} | p95 (med) | 3.2 (3.1) | 3.8 (3.4) | +18.9 |  |
| req_wall_ms{persona:hr,screen:trend,endpoint:trend} | p95 (med) | 462.8 (419.9) | 99.6 (74.4) | -78.5 | improved |
| req_wall_ms{persona:hr,screen:trend,endpoint:visible-teams} | p95 (med) | 4.6 (4.2) | 4.3 (3.5) | -6.4 |  |
| screen_db_ms{persona:hr,screen:participation} | p95 (med) | 17.0 (16.5) | 12.5 (9.9) | -26.6 | improved |
| screen_db_ms{persona:hr,screen:results} | p95 (med) | 24351.0 (23778.1) | 1100.4 (1052.2) | -95.5 | improved |
| screen_db_ms{persona:hr,screen:survey} | p95 (med) | 13.3 (11.1) | 11.6 (11.5) | -12.6 |  |
| screen_db_ms{persona:hr,screen:trend} | p95 (med) | 23889.1 (23622.9) | 4981.2 (4749.2) | -79.1 | improved |
| screen_requests{persona:hr,screen:participation} | median | 6 | 6 | +0.0 |  |
| screen_requests{persona:hr,screen:results} | median | 259 | 178 | -31.3 | CHANGED |
| screen_requests{persona:hr,screen:survey} | median | 6 | 6 | +0.0 |  |
| screen_requests{persona:hr,screen:trend} | median | 89 | 89 | +0.0 |  |
| screen_seq_ms{persona:hr,screen:participation} | p95 (med) | 25.0 (23.7) | 19.6 (16.6) | -21.8 | improved |
| screen_seq_ms{persona:hr,screen:results} | p95 (med) | 35541.9 (35235.3) | 1652.4 (1646.7) | -95.4 | improved |
| screen_seq_ms{persona:hr,screen:survey} | p95 (med) | 20.5 (17.1) | 19.9 (16.5) | -2.8 |  |
| screen_seq_ms{persona:hr,screen:trend} | p95 (med) | 35874.2 (35555.9) | 5574.8 (5503.1) | -84.5 | improved |
| screen_stmt{persona:hr,screen:participation} | median | 21 | 21 | +0.0 |  |
| screen_stmt{persona:hr,screen:results} | median | 23708 | 1298 | -94.5 | CHANGED |
| screen_stmt{persona:hr,screen:survey} | median | 18 | 18 | +0.0 |  |
| screen_stmt{persona:hr,screen:trend} | median | 22195 | 523 | -97.6 | CHANGED |
| screen_tx{persona:hr,screen:participation} | median | 17 | 17 | +0.0 |  |
| screen_tx{persona:hr,screen:results} | median | 23369 | 1124 | -95.2 | CHANGED |
| screen_tx{persona:hr,screen:survey} | median | 14 | 14 | +0.0 |  |
| screen_tx{persona:hr,screen:trend} | median | 22109 | 437 | -98.0 | CHANGED |
| screen_wall_ms{persona:hr,screen:participation} | p95 (med) | 15 (15) | 11.7 (9) | -22.0 | improved |
| screen_wall_ms{persona:hr,screen:results} | p95 (med) | 6526.8 (6444) | 296.7 (294) | -95.5 | improved |
| screen_wall_ms{persona:hr,screen:survey} | p95 (med) | 7.9 (7) | 9.8 (8) | +24.1 |  |
| screen_wall_ms{persona:hr,screen:trend} | p95 (med) | 6007.1 (5972) | 955 (955) | -84.1 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT pulse_responses.id, pulse_responses.cycle_id, pulse_responses.user_id, pulse_respon` | 65520 | - | - | 889.3 | - | GONE |
| `SELECT COUNT(*) FROM pulse_participants WHERE (pulse_participants.cycle_id = $1) AND (puls` | 65268 | - | - | 632.3 | - | GONE |
| `SELECT pulse_responses.cycle_id, pulse_responses.enps, pulse_responses.driver1, pulse_resp` | - | 513 | - | - | 144.9 | NEW |
| `SELECT $1` | 136514 | 4763 | -96.5 | 94 | 4.2 | CHANGED |
| `SELECT pulse_cycles.id, pulse_cycles.status, pulse_cycles.planned_open_date, pulse_cycles.` | 1275 | 1032 | -19.1 | 58.9 | 43.1 | CHANGED |
| `SELECT pulse_participants.cycle_id, COUNT(pulse_participants.user_id) FROM pulse_participa` | - | 513 | - | - | 55.3 | NEW |
| `SELECT team_members.user_id FROM team_members INNER JOIN teams ON team_members.team_id = t` | 1008 | 765 | -24.1 | 11.2 | 9 | CHANGED |
| `SELECT teams.id, teams."name", teams.manager_id, teams.marked_as_deleted FROM teams WHERE ` | 1008 | - | - | 7.1 | - | GONE |
| `SELECT team_members.team_id, team_members.user_id FROM team_members WHERE team_members.tea` | 1008 | - | - | 6.6 | - | GONE |
| `SELECT document_shares.sharer_id FROM document_shares WHERE (document_shares.resource_type` | 504 | - | - | 6.2 | - | GONE |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 2577 | 2091 | improved |
| pulse_cycles | 1275 | 1032 | improved |
| revoked_tokens | 1080 | 837 | improved |
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
| chain_wall_ms{persona:ceo-all,chain:dictionaries} | p95 (med) | 5.8 (5.1) | 5.1 (4.7) | -12.7 |  |
| chain_wall_ms{persona:ceo-all,chain:members} | p95 (med) | 457.3 (452.3) | 122.1 (101.8) | -73.3 | improved |
| chain_wall_ms{persona:ceo-all,chain:periods} | p95 (med) | 1.7 (1.5) | 1.6 (1.4) | -8.1 |  |
| chain_wall_ms{persona:ceo-all,chain:probe} | p95 (med) | 2.3 (2.2) | 2.0 (1.9) | -13.6 |  |
| chain_wall_ms{persona:ceo-all,chain:reviews} | p95 (med) | 48.4 (44.6) | 28.2 (26.3) | -41.8 | improved |
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
| req_wall_ms{persona:ceo-all,endpoint:dictionaries} | p95 (med) | 2.0 (1.6) | 2.0 (1.5) | -3.5 |  |
| req_wall_ms{persona:ceo-all,endpoint:members} | p95 (med) | 90.3 (85.2) | 22.6 (18.1) | -74.9 | improved |
| req_wall_ms{persona:ceo-all,endpoint:periods} | p95 (med) | 1.7 (1.5) | 1.6 (1.4) | -8.1 |  |
| req_wall_ms{persona:ceo-all,endpoint:probe} | p95 (med) | 2.3 (2.2) | 2.0 (1.9) | -13.6 |  |
| req_wall_ms{persona:ceo-all,endpoint:reviews} | p95 (med) | 13.6 (11.2) | 7.6 (6.6) | -43.9 | improved |
| req_wall_ms{persona:ceo-all,endpoint:users} | p95 (med) | 0 (0) | 0 (0) | +0.0 |  |
| screen_critical_ms{persona:ceo-all} | p95 (med) | 457.3 (452.3) | 122.1 (101.8) | -73.3 | improved |
| screen_db_ms{persona:ceo-all} | p95 (med) | 483.1 (475.2) | 131.1 (111.8) | -72.9 | improved |
| screen_requests{persona:ceo-all} | median | 15 | 15 | +0.0 |  |
| screen_stmt{persona:ceo-all} | median | 1190 | 183 | -84.6 | CHANGED |
| screen_tx{persona:ceo-all} | median | 84 | 84 | +0.0 |  |
| screen_wall_ms{persona:ceo-all} | p95 (med) | 514.4 (504.4) | 158.4 (133.4) | -69.2 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT one_on_one_meetings.id, one_on_one_meetings.meeting_date FROM one_on_one_meetings W` | 1530 | - | - | 56.8 | - | GONE |
| `SELECT days_off_requests.user_id, days_off_requests.pool_type_id, days_off_requests.start_` | 15 | 15 | +0.0 | 14.3 | 6.5 |  |
| `SELECT performance_reviews.id, review_periods.start_month, review_periods.end_month, perfo` | 1530 | - | - | 12.9 | - | GONE |
| `SELECT performance_reviews.id, performance_reviews.manager_id, performance_reviews.subordi` | 12 | 12 | +0.0 | 4.8 | 4.9 |  |
| `SELECT feedbacks.id, feedback_subjects.user_id, feedbacks.last_modified FROM feedbacks INN` | 18 | 15 | -16.7 | 4.8 | 3.3 | CHANGED |
| `SELECT feedbacks.id, feedbacks.subject_id, feedbacks.last_modified FROM feedbacks WHERE (f` | 18 | 15 | -16.7 | 3.8 | 3.6 | CHANGED |
| `SELECT COUNT(*) FROM performance_reviews INNER JOIN users manager_users ON performance_rev` | 12 | 12 | +0.0 | 3.6 | 3 |  |
| `SELECT team_members.user_id FROM team_members INNER JOIN teams ON team_members.team_id = t` | 60 | 60 | +0.0 | 3.1 | 3.4 |  |
| `SELECT goals.subordinate_id, COUNT(goals.id) FROM goals WHERE (goals.manager_id = $1) AND ` | 18 | 15 | -16.7 | 2.9 | 2.8 | CHANGED |
| `SELECT COUNT(*) FROM team_members INNER JOIN teams ON team_members.team_id = teams.id INNE` | 18 | 18 | +0.0 | 2.7 | 2.8 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| review_periods | 327 | 45 | improved |
| teams | 144 | 144 |  |
| team_members | 123 | 123 |  |
| users | 111 | 111 |  |
| revoked_tokens | 45 | 45 |  |
| days_off_pool_types | 36 | 36 |  |
| dictionary_entries | 27 | 27 |  |
| days_off_corrections | 18 | 18 |  |
| days_off_pools | 15 | 15 |  |
| login_lockouts | 2 | 2 |  |
| user_roles | 1 | 1 |  |

## succession.hr.vu1
| metric | stat | baseline | current | Δ % | flag |
|---|---|---|---|---|---|
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:list} | median | 4 | 4 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | median | 3 | 3 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:shell-user} | median | 5 | 5 | +0.0 |  |
| req_stmt{persona:hr,screen:drilldown-audit,endpoint:users} | median | 8 | 8 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:list} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:hr,screen:drilldown-audit,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:list} | p95 (med) | 6.7 (6.6) | 8.5 (3.9) | +27.6 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-alerts} | p95 (med) | 4.6 (3.7) | 6.6 (3.0) | +42.2 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-bell} | p95 (med) | 4.8 (3.5) | 6.6 (2.8) | +37.4 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-probe} | p95 (med) | 3.8 (3.6) | 6.1 (3.7) | +59.2 | REGRESSED |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:shell-user} | p95 (med) | 7.3 (4.7) | 7.3 (3.2) | +0.8 |  |
| req_wall_ms{persona:hr,screen:drilldown-audit,endpoint:users} | p95 (med) | 9.0 (6.2) | 7.8 (3.1) | -13.5 |  |
| screen_db_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 49.0 (48.9) | 25.3 (11.4) | -48.4 | improved |
| screen_requests{persona:hr,screen:drilldown-audit} | median | 11 | 6 | -45.5 | CHANGED |
| screen_seq_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 65.4 (62.1) | 42.8 (18.7) | -34.5 | improved |
| screen_stmt{persona:hr,screen:drilldown-audit} | median | 65 | 25 | -61.5 | CHANGED |
| screen_tx{persona:hr,screen:drilldown-audit} | median | 23 | 13 | -43.5 | CHANGED |
| screen_wall_ms{persona:hr,screen:drilldown-audit} | p95 (med) | 48.5 (44) | 8.6 (5) | -82.3 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | - | - | 1.6 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 15 | - | - | 0.9 | - | GONE |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 18 | - | - | 0.9 | - | GONE |
| `SELECT teams.id, teams."name", teams.manager_id, users."name", users.marked_as_deleted FRO` | 3 | 3 | +0.0 | 0 | 0.7 |  |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 18 | - | - | 0.6 | - | GONE |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 15 | - | - | 0.6 | - | GONE |
| `SELECT COUNT(*) FROM succession_plans INNER JOIN users manager_users ON succession_plans.m` | - | 3 | - | - | 0.4 | NEW |
| `SELECT succession_plans.id, succession_plans.manager_id, succession_plans.user_id, success` | 3 | 3 | +0.0 | 0.3 | 0.3 |  |
| `SELECT dictionary_entries.id, dictionary_entries."dictionary", dictionary_entries."positio` | 18 | - | - | 0.3 | - | GONE |
| `SELECT COUNT(*) FROM succession_plans INNER JOIN users manager_users ON succession_plans.m` | 3 | - | - | 0.2 | - | GONE |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| revoked_tokens | 33 | 18 | improved |
| users | 33 | 6 | improved |
| teams | 24 | 9 | improved |
| user_roles | 23 | 8 | improved |
| dictionary_entries | 18 | 3 | improved |
| user_disabled_features | 15 | 0 | improved |
| login_lockouts | 4 | 4 |  |
| alerts | 3 | 3 |  |

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
| req_stmt{persona:admin,screen:teams,endpoint:teams-all} | median | - | 4 | - | NEW |
| req_stmt{persona:admin,screen:teams,endpoint:teams} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:admin,screen:teams,endpoint:users-all} | median | 9 | - | - | MISSING |
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
| req_tx{persona:admin,screen:teams,endpoint:teams-all} | median | - | 2 | - | NEW |
| req_tx{persona:admin,screen:teams,endpoint:teams} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:teams,endpoint:users-all} | median | 2 | - | - | MISSING |
| req_tx{persona:admin,screen:users,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:admin,screen:users,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users-deep,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:admin,screen:users-filtered,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:shell-alerts} | p95 (med) | 3.9 (2.3) | 2.6 (1.9) | -33.5 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:shell-bell} | p95 (med) | 3.5 (2.7) | 3.0 (2.0) | -15.2 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:shell-probe} | p95 (med) | 3.5 (2.8) | 2.9 (2.5) | -19.5 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:shell-user} | p95 (med) | 4.6 (3.8) | 3.3 (2.9) | -28.4 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:teams-all} | p95 (med) | 4.0 (3.0) | 5.0 (4.0) | +25.9 |  |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:team} | p95 (med) | 5.7 (3.6) | - (-) | - | MISSING |
| req_wall_ms{persona:admin,screen:org-chart,endpoint:users-all} | p95 (med) | 16.6 (11.0) | 5.5 (3.6) | -66.7 | improved |
| req_wall_ms{persona:admin,screen:teams,endpoint:shell-alerts} | p95 (med) | 2.5 (2.3) | 2.5 (2.1) | +2.5 |  |
| req_wall_ms{persona:admin,screen:teams,endpoint:shell-bell} | p95 (med) | 3.3 (3.0) | 3.0 (2.7) | -6.7 |  |
| req_wall_ms{persona:admin,screen:teams,endpoint:shell-probe} | p95 (med) | 2.8 (2.5) | 2.9 (2.6) | +2.7 |  |
| req_wall_ms{persona:admin,screen:teams,endpoint:shell-user} | p95 (med) | 4.3 (3.8) | 4.5 (3.6) | +5.3 |  |
| req_wall_ms{persona:admin,screen:teams,endpoint:teams-all} | p95 (med) | - (-) | 4.5 (3.8) | - | NEW |
| req_wall_ms{persona:admin,screen:teams,endpoint:teams} | p95 (med) | 3.0 (2.9) | 3.9 (3.6) | +29.2 |  |
| req_wall_ms{persona:admin,screen:teams,endpoint:users-all} | p95 (med) | 8.3 (6.1) | - (-) | - | MISSING |
| req_wall_ms{persona:admin,screen:users,endpoint:shell-alerts} | p95 (med) | 3.1 (2.7) | 2.9 (1.9) | -7.3 |  |
| req_wall_ms{persona:admin,screen:users,endpoint:shell-bell} | p95 (med) | 3.6 (3.2) | 2.7 (1.9) | -23.0 |  |
| req_wall_ms{persona:admin,screen:users,endpoint:shell-probe} | p95 (med) | 3.1 (2.9) | 2.7 (2.4) | -15.5 |  |
| req_wall_ms{persona:admin,screen:users,endpoint:shell-user} | p95 (med) | 4.0 (3.3) | 4.2 (3.1) | +6.7 |  |
| req_wall_ms{persona:admin,screen:users,endpoint:users} | p95 (med) | 6.4 (6.3) | 4.6 (3.5) | -27.6 |  |
| req_wall_ms{persona:admin,screen:users-deep,endpoint:users} | p95 (med) | 4.9 (4.0) | 2.8 (2.7) | -43.1 | improved |
| req_wall_ms{persona:admin,screen:users-filtered,endpoint:users} | p95 (med) | 6.9 (3.1) | 2.5 (2.4) | -63.6 | improved |
| screen_db_ms{persona:admin,screen:org-chart} | p95 (med) | 302.6 (296.2) | 28.4 (26.6) | -90.6 | improved |
| screen_db_ms{persona:admin,screen:teams} | p95 (med) | 45.8 (39.1) | 13.6 (11.9) | -70.3 | improved |
| screen_db_ms{persona:admin,screen:users-deep} | p95 (med) | 4.1 (3.4) | 2.3 (2.1) | -44.7 |  |
| screen_db_ms{persona:admin,screen:users-filtered} | p95 (med) | 6.1 (2.3) | 2.0 (1.9) | -67.3 | improved |
| screen_db_ms{persona:admin,screen:users} | p95 (med) | 13.8 (12.9) | 10.6 (7.7) | -23.3 | improved |
| screen_requests{persona:admin,screen:org-chart} | median | 95 | 11 | -88.4 | CHANGED |
| screen_requests{persona:admin,screen:teams} | median | 11 | 6 | -45.5 | CHANGED |
| screen_requests{persona:admin,screen:users-deep} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:admin,screen:users-filtered} | median | 1 | 1 | +0.0 |  |
| screen_requests{persona:admin,screen:users} | median | 5 | 5 | +0.0 |  |
| screen_seq_ms{persona:admin,screen:org-chart} | p95 (med) | 420.3 (403.4) | 39.5 (37.6) | -90.6 | improved |
| screen_seq_ms{persona:admin,screen:teams} | p95 (med) | 58.9 (49.9) | 20.6 (17.4) | -65.0 | improved |
| screen_seq_ms{persona:admin,screen:users-deep} | p95 (med) | 4.9 (4.0) | 2.8 (2.7) | -43.1 | improved |
| screen_seq_ms{persona:admin,screen:users-filtered} | p95 (med) | 6.9 (3.1) | 2.5 (2.4) | -63.6 | improved |
| screen_seq_ms{persona:admin,screen:users} | p95 (med) | 19.5 (19.2) | 17.0 (12.0) | -12.5 | improved |
| screen_stmt{persona:admin,screen:org-chart} | median | 558 | 71 | -87.3 | CHANGED |
| screen_stmt{persona:admin,screen:teams} | median | 70 | 21 | -70.0 | CHANGED |
| screen_stmt{persona:admin,screen:users-deep} | median | 9 | 9 | +0.0 |  |
| screen_stmt{persona:admin,screen:users-filtered} | median | 4 | 4 | +0.0 |  |
| screen_stmt{persona:admin,screen:users} | median | 22 | 22 | +0.0 |  |
| screen_tx{persona:admin,screen:org-chart} | median | 275 | 23 | -91.6 | CHANGED |
| screen_tx{persona:admin,screen:teams} | median | 23 | 13 | -43.5 | CHANGED |
| screen_tx{persona:admin,screen:users-deep} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:admin,screen:users-filtered} | median | 2 | 2 | +0.0 |  |
| screen_tx{persona:admin,screen:users} | median | 11 | 11 | +0.0 |  |
| screen_wall_ms{persona:admin,screen:org-chart} | p95 (med) | 107.2 (82) | 33.7 (31) | -68.6 | improved |
| screen_wall_ms{persona:admin,screen:teams} | p95 (med) | 48.3 (42) | 5.9 (5) | -87.8 | improved |
| screen_wall_ms{persona:admin,screen:users-deep} | p95 (med) | 4.9 (4) | 2.9 (2) | -40.8 | improved |
| screen_wall_ms{persona:admin,screen:users-filtered} | p95 (med) | 6.6 (3) | 3 (3) | -54.5 | improved |
| screen_wall_ms{persona:admin,screen:users} | p95 (med) | 7 (7) | 4.9 (4) | -30.0 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT teams.manager_id FROM team_members INNER JOIN teams ON team_members.team_id = teams` | 708 | - | - | 10.2 | - | GONE |
| `SELECT teams."name", teams.manager_id, users."name", users.marked_as_deleted FROM teams IN` | 252 | - | - | 3.6 | - | GONE |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 30 | - | - | 3.1 | - | GONE |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | - | 15 | - | - | 2.6 | NEW |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 42 | 24 | -42.9 | 1.9 | 0.9 | CHANGED |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 30 | - | - | 1.7 | - | GONE |
| `SELECT team_members.team_id, team_members.user_id FROM team_members WHERE team_members.tea` | 252 | - | - | 1.4 | - | GONE |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 42 | 24 | -42.9 | 1.4 | 0.8 | CHANGED |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 30 | - | - | 1.2 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | - | 18 | - | - | 1 | NEW |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 1077 | 87 | improved |
| revoked_tokens | 339 | 72 | improved |
| users | 72 | 45 | improved |
| user_roles | 52 | 34 | improved |
| dictionary_entries | 42 | 24 | improved |
| user_disabled_features | 30 | 15 | improved |
| team_members | 5 | 23 | MORE SEQ SCANS |
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
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:shell-alerts} | p95 (med) | 3.1 (2.3) | 3.5 (3.0) | +11.4 |  |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:shell-bell} | p95 (med) | 4.1 (3.7) | 5.0 (3.4) | +22.1 |  |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:shell-probe} | p95 (med) | 3.5 (2.4) | 3.9 (3.8) | +12.3 |  |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:shell-user} | p95 (med) | 4.8 (3.7) | 5.2 (3.9) | +7.3 |  |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:teams-all} | p95 (med) | 4.2 (3.3) | 5.2 (4.5) | +23.5 |  |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:team} | p95 (med) | 5.0 (3.2) | - (-) | - | MISSING |
| req_wall_ms{persona:ceo,screen:org-chart,endpoint:users-all} | p95 (med) | 50.3 (41.5) | 7.2 (4.6) | -85.7 | improved |
| screen_db_ms{persona:ceo,screen:org-chart} | p95 (med) | 453.7 (423.1) | 37.2 (36.9) | -91.8 | improved |
| screen_requests{persona:ceo,screen:org-chart} | median | 95 | 11 | -88.4 | CHANGED |
| screen_seq_ms{persona:ceo,screen:org-chart} | p95 (med) | 596.7 (523.3) | 52.9 (46.5) | -91.1 | improved |
| screen_stmt{persona:ceo,screen:org-chart} | median | 496 | 91 | -81.7 | CHANGED |
| screen_tx{persona:ceo,screen:org-chart} | median | 275 | 23 | -91.6 | CHANGED |
| screen_wall_ms{persona:ceo,screen:org-chart} | p95 (med) | 109 (109) | 39.7 (37) | -63.6 | improved |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT teams.manager_id FROM team_members INNER JOIN teams ON team_members.team_id = teams` | 465 | - | - | 8 | - | GONE |
| `SELECT teams."name", teams.manager_id, users."name", users.marked_as_deleted FROM teams IN` | 252 | - | - | 3.5 | - | GONE |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 15 | 15 | +0.0 | 1.6 | 3 |  |
| `SELECT team_members.user_id FROM team_members INNER JOIN teams ON team_members.team_id = t` | 36 | 36 | +0.0 | 2.1 | 1.9 |  |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 3 | 3 | +0.0 | 1.4 | 1.3 |  |
| `SELECT team_members.team_id, team_members.user_id FROM team_members WHERE team_members.tea` | 252 | 3 | -98.8 | 1.3 | 0 | CHANGED |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 3 | 3 | +0.0 | 1 | 1.2 |  |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 15 | 15 | +0.0 | 0.9 | 0.8 |  |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 18 | 18 | +0.0 | 0.9 | 0.8 |  |
| `SELECT team_members.user_id FROM team_members INNER JOIN teams ON team_members.team_id = t` | 18 | 18 | +0.0 | 0.8 | 0.7 |  |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 819 | 102 | improved |
| revoked_tokens | 285 | 33 | improved |
| team_members | 54 | 60 | MORE SEQ SCANS |
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
| req_stmt{persona:ic,screen:teams,endpoint:teams-all} | median | - | 4 | - | NEW |
| req_stmt{persona:ic,screen:teams,endpoint:teams} | median | 3 | 4 | +33.3 | CHANGED |
| req_stmt{persona:ic,screen:teams,endpoint:users-all} | median | 9 | - | - | MISSING |
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
| req_tx{persona:ic,screen:teams,endpoint:teams-all} | median | - | 2 | - | NEW |
| req_tx{persona:ic,screen:teams,endpoint:teams} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:teams,endpoint:users-all} | median | 2 | - | - | MISSING |
| req_tx{persona:ic,screen:users,endpoint:shell-alerts} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:users,endpoint:shell-bell} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:users,endpoint:shell-probe} | median | 2 | 2 | +0.0 |  |
| req_tx{persona:ic,screen:users,endpoint:shell-user} | median | 3 | 3 | +0.0 |  |
| req_tx{persona:ic,screen:users,endpoint:users} | median | 2 | 2 | +0.0 |  |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:shell-alerts} | p95 (med) | 2.9 (2.2) | 3.3 (2.2) | +12.5 |  |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:shell-bell} | p95 (med) | 3.5 (2.7) | 5.1 (2.8) | +44.0 |  |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:shell-probe} | p95 (med) | 3.0 (2.8) | 3.3 (2.4) | +7.7 |  |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:shell-user} | p95 (med) | 3.7 (3.6) | 6.7 (4.1) | +80.3 | REGRESSED |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:teams-all} | p95 (med) | 3.3 (3.0) | 6.5 (3.3) | +96.7 | REGRESSED |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:team} | p95 (med) | 5.8 (3.4) | - (-) | - | MISSING |
| req_wall_ms{persona:ic,screen:org-chart,endpoint:users-all} | p95 (med) | 11.9 (10.1) | 5.4 (3.4) | -54.7 | improved |
| req_wall_ms{persona:ic,screen:teams,endpoint:shell-alerts} | p95 (med) | 2.5 (1.9) | 2.5 (2.3) | +0.0 |  |
| req_wall_ms{persona:ic,screen:teams,endpoint:shell-bell} | p95 (med) | 3.3 (3.1) | 7.2 (4.5) | +119.6 | REGRESSED |
| req_wall_ms{persona:ic,screen:teams,endpoint:shell-probe} | p95 (med) | 2.9 (2.8) | 2.4 (2.3) | -15.8 |  |
| req_wall_ms{persona:ic,screen:teams,endpoint:shell-user} | p95 (med) | 3.7 (3.7) | 7.5 (4.2) | +100.9 | REGRESSED |
| req_wall_ms{persona:ic,screen:teams,endpoint:teams-all} | p95 (med) | - (-) | 7.5 (4.8) | - | NEW |
| req_wall_ms{persona:ic,screen:teams,endpoint:teams} | p95 (med) | 2.9 (2.6) | 7.6 (4.6) | +162.2 | REGRESSED |
| req_wall_ms{persona:ic,screen:teams,endpoint:users-all} | p95 (med) | 7.6 (6.0) | - (-) | - | MISSING |
| req_wall_ms{persona:ic,screen:users,endpoint:shell-alerts} | p95 (med) | 2.8 (2.0) | 2.6 (2.0) | -7.7 |  |
| req_wall_ms{persona:ic,screen:users,endpoint:shell-bell} | p95 (med) | 4.0 (2.9) | 4.4 (2.5) | +11.0 |  |
| req_wall_ms{persona:ic,screen:users,endpoint:shell-probe} | p95 (med) | 3.2 (2.1) | 2.8 (2.6) | -14.1 |  |
| req_wall_ms{persona:ic,screen:users,endpoint:shell-user} | p95 (med) | 3.7 (3.5) | 4.7 (3.2) | +28.5 |  |
| req_wall_ms{persona:ic,screen:users,endpoint:users} | p95 (med) | 5.8 (5.0) | 4.4 (3.7) | -25.0 |  |
| screen_db_ms{persona:ic,screen:org-chart} | p95 (med) | 279.4 (275.0) | 29.4 (26.4) | -89.5 | improved |
| screen_db_ms{persona:ic,screen:teams} | p95 (med) | 40.8 (39.5) | 23.9 (15.5) | -41.4 | improved |
| screen_db_ms{persona:ic,screen:users} | p95 (med) | 12.6 (11.5) | 12.0 (9.5) | -4.5 |  |
| screen_requests{persona:ic,screen:org-chart} | median | 95 | 11 | -88.4 | CHANGED |
| screen_requests{persona:ic,screen:teams} | median | 11 | 6 | -45.5 | CHANGED |
| screen_requests{persona:ic,screen:users} | median | 5 | 5 | +0.0 |  |
| screen_seq_ms{persona:ic,screen:org-chart} | p95 (med) | 392.5 (388.7) | 47.0 (36.6) | -88.0 | improved |
| screen_seq_ms{persona:ic,screen:teams} | p95 (med) | 51.8 (48.4) | 34.6 (21.9) | -33.2 | improved |
| screen_seq_ms{persona:ic,screen:users} | p95 (med) | 19.3 (15.7) | 18.9 (13.9) | -2.4 |  |
| screen_stmt{persona:ic,screen:org-chart} | median | 559 | 72 | -87.1 | CHANGED |
| screen_stmt{persona:ic,screen:teams} | median | 71 | 22 | -69.0 | CHANGED |
| screen_stmt{persona:ic,screen:users} | median | 23 | 23 | +0.0 |  |
| screen_tx{persona:ic,screen:org-chart} | median | 275 | 23 | -91.6 | CHANGED |
| screen_tx{persona:ic,screen:teams} | median | 23 | 13 | -43.5 | CHANGED |
| screen_tx{persona:ic,screen:users} | median | 11 | 11 | +0.0 |  |
| screen_wall_ms{persona:ic,screen:org-chart} | p95 (med) | 97.4 (74) | 28.9 (28) | -70.3 | improved |
| screen_wall_ms{persona:ic,screen:teams} | p95 (med) | 40.8 (39) | 8.7 (6) | -78.7 | improved |
| screen_wall_ms{persona:ic,screen:users} | p95 (med) | 6 (6) | 5.9 (5) | -1.7 |  |

**Top 10 statements** (calls and total ms in the window):
| statement | calls base | calls cur | Δ % | total ms base | total ms cur | flag |
|---|---|---|---|---|---|---|
| `SELECT teams.manager_id FROM team_members INNER JOIN teams ON team_members.team_id = teams` | 708 | - | - | 9.7 | - | GONE |
| `SELECT users.id, users."name", users.email, users.password_hash, users.marked_as_deleted, ` | 30 | 15 | -50.0 | 3.7 | 1.8 | CHANGED |
| `SELECT teams."name", teams.manager_id, users."name", users.marked_as_deleted FROM teams IN` | 252 | - | - | 3.5 | - | GONE |
| `SELECT user_disabled_features.user_id, user_disabled_features.feature FROM user_disabled_f` | 39 | - | - | 1.7 | - | GONE |
| `SELECT team_members.user_id, teams.id, teams."name", teams.manager_id FROM team_members IN` | 30 | 15 | -50.0 | 1.7 | 0.8 | CHANGED |
| `SELECT COUNT(*) FROM notifications WHERE (notifications.recipient_id = $1) AND (notificati` | 9 | 9 | +0.0 | 1.5 | 1.5 |  |
| `SELECT team_members.team_id, team_members.user_id FROM team_members WHERE team_members.tea` | 252 | - | - | 1.4 | - | GONE |
| `SELECT COUNT(*) FROM users WHERE TRUE AND (users.marked_as_deleted = $1)` | 39 | 21 | -46.2 | 1.3 | 0.7 | CHANGED |
| `SELECT notifications.id, notifications.recipient_id, notifications.created_at, notificatio` | 9 | 9 | +0.0 | 1.2 | 1.2 |  |
| `SELECT user_career_positions.user_id, user_career_positions.start_date, user_career_positi` | 30 | 15 | -50.0 | 1.1 | 0.5 | CHANGED |

**Sequential scans per table:**
| table | seq_scan base | seq_scan cur | flag |
|---|---|---|---|
| teams | 1068 | 78 | improved |
| revoked_tokens | 333 | 66 | improved |
| users | 60 | 33 | improved |
| user_roles | 49 | 31 | improved |
| dictionary_entries | 48 | 30 | improved |
| user_disabled_features | 30 | 15 | improved |
| team_members | 3 | 20 | MORE SEQ SCANS |
| alerts | 9 | 9 |  |
| login_lockouts | 2 | 2 |  |

Baseline runs with no counterpart in this run: `activity-log.director.vu1`, `activity-log.ic.vu1`, `dashboard.admin.vu1`, `dashboard.director.vu1`, `dashboard.hr.vu1`, `dashboard.ic.vu1`, `dashboard.lead.vu1`, `days-off.ceo.vu1`, `days-off.director.vu1`, `days-off.ic.vu1`, `feedback-lists.ceo.vu1`, `feedback-lists.hr.vu1`, `feedback-lists.ic.vu1`, `feedback-lists.lead.vu1`, `impact-log.ceo.vu1`, `impact-log.ic.vu1`, `login.ic.vu1`, `login.mixed.vu50`, `mixed-50vu.mixed.vu50`, `notifications-bell.ceo.vu1`, `notifications-bell.hr.vu1`, `notifications-bell.ic.vu1`, `one-on-ones.director.vu1`, `one-on-ones.ic.vu1`, `pulse-results.ceo.vu1`, `pulse-results.ic.vu1`, `pulse-results.lead.vu1`, `reviews-team-view.ceo-all.vu50`, `reviews-team-view.ceo-direct.vu1`, `reviews-team-view.director-all.vu1`, `reviews-team-view.director-all.vu50`, `reviews-team-view.hr.vu1`, `reviews-team-view.hr.vu50`, `reviews-team-view.lead-2.vu1`, `reviews-team-view.lead.vu1`, `reviews-team-view.lead.vu50`, `reviews-team-view.mixed.vu50`, `succession.ceo.vu1`, `succession.lead.vu1`, `team-kpis.ceo.vu1`, `team-kpis.hr.vu1`, `team-kpis.ic.vu1`, `team-kpis.lead.vu1`
