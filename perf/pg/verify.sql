-- Post-seed assertions for the perf dataset (.claude/docs/performance.md, "The dataset contract").
-- Run against the seeded database:
--   docker compose -p lettuce-perf exec -T postgres psql -U lettuce -d lettuce -v ON_ERROR_STOP=1 -f - < perf/pg/verify.sql
-- Every check counts VIOLATIONS; the script prints one line per check and fails (non-zero exit under
-- ON_ERROR_STOP) when any count is above zero. The seed-<version>.json row counts are compared by
-- perf/run.sh (they depend on scale/anchor); the invariants below hold at every scale.
\set ON_ERROR_STOP on
\set QUIET on

CREATE TEMP TABLE verify_checks (name text NOT NULL, violations bigint NOT NULL);

-- 1. Encryption envelopes. A plaintext value would be rewritten by the app's boot backfill
--    (encryptLegacyRows) and the dataset would stop being deterministic; the columns are the
--    EncryptedAtRest registrants' (the rotation backfill list in infra/db/Bootstrap.kt).
DO $$
DECLARE c record; n bigint;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('feedbacks', 'content'), ('feedbacks', 'requester_message'),
    ('one_on_one_notes', 'content'), ('one_on_one_action_items', 'content'),
    ('goals', 'description'), ('goals', 'summary'), ('goal_milestones', 'description'), ('goal_events', 'comment'),
    ('performance_reviews', 'attitude_rating'), ('performance_reviews', 'attitude_summary'),
    ('performance_reviews', 'delivery_rating'), ('performance_reviews', 'delivery_summary'),
    ('performance_reviews', 'skills_rating'), ('performance_reviews', 'skills_summary'),
    ('performance_reviews', 'aptitude_rating'), ('performance_reviews', 'aptitude_summary'),
    ('performance_reviews', 'overall_rating'), ('performance_reviews', 'overall_summary'),
    ('team_kpis', 'description'), ('team_kpis', 'summary'),
    ('impact_log_entries', 'what_happened'), ('impact_log_entries', 'contribution'),
    ('impact_log_entries', 'why_it_mattered'), ('impact_log_entries', 'evidence'),
    ('succession_plans', 'loss_impact'), ('succession_nominations', 'competency_gaps'),
    ('days_off_corrections', 'comment'),
    ('pulse_responses', 'enps'), ('pulse_responses', 'driver1'), ('pulse_responses', 'driver2'),
    ('pulse_responses', 'driver3'), ('pulse_responses', 'driver4'), ('pulse_responses', 'rotating'),
    ('pulse_responses', 'comment')
  ) AS t(tbl, col) LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I IS NOT NULL AND %I NOT LIKE %L', c.tbl, c.col, c.col, 'enc:v1:%') INTO n;
    INSERT INTO verify_checks VALUES (format('envelope: %s.%s has no plaintext value', c.tbl, c.col), n);
  END LOOP;
END $$;

-- 2. The partial-unique invariants (the indexes enforce them; this proves the data satisfied them
--    without relying on a swallowed insert error).
INSERT INTO verify_checks SELECT 'one active review per (subordinate, period)', count(*) FROM (
  SELECT subordinate_id, period_id FROM performance_reviews WHERE NOT marked_as_deleted
  GROUP BY 1, 2 HAVING count(*) > 1) d;
INSERT INTO verify_checks SELECT 'uq_users_email_active: one active user per email', count(*) FROM (
  SELECT email FROM users WHERE NOT marked_as_deleted GROUP BY 1 HAVING count(*) > 1) d;
INSERT INTO verify_checks SELECT 'review periods are gapless', count(*) FROM (
  SELECT start_month, lag(end_month) OVER (ORDER BY start_month) AS prev_end FROM review_periods) p
  WHERE prev_end IS NOT NULL AND to_char(to_date(prev_end || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM') <> start_month;

-- 3. Org consistency: a review's / goal's / 1:1's manager is the manager of a team the subordinate belongs to.
INSERT INTO verify_checks SELECT 'performance_reviews.manager_id is the subordinate''s team manager', count(*) FROM performance_reviews r
  WHERE NOT EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
                    WHERE tm.user_id = r.subordinate_id AND t.manager_id = r.manager_id);
INSERT INTO verify_checks SELECT 'goals.manager_id is the subordinate''s team manager', count(*) FROM goals g
  WHERE NOT EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
                    WHERE tm.user_id = g.subordinate_id AND t.manager_id = g.manager_id);
INSERT INTO verify_checks SELECT 'one_on_one_meetings.manager_id is the subordinate''s team manager', count(*) FROM one_on_one_meetings m
  WHERE NOT EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
                    WHERE tm.user_id = m.subordinate_id AND t.manager_id = m.manager_id);

-- 4. 1:1 invariants: chronological per pair, one meeting per (pair, date), carry-over only from the pair's own earlier meeting.
INSERT INTO verify_checks SELECT 'one meeting per (manager, subordinate, date)', count(*) FROM (
  SELECT 1 FROM one_on_one_meetings WHERE NOT marked_as_deleted GROUP BY manager_id, subordinate_id, meeting_date HAVING count(*) > 1) d;
INSERT INTO verify_checks SELECT 'carried action items copy an unresolved item of the pair''s earlier meeting', count(*) FROM one_on_one_action_items c
  JOIN one_on_one_meetings cm ON cm.id = c.meeting_id
  JOIN one_on_one_action_items s ON s.id = c.copied_from_id
  JOIN one_on_one_meetings sm ON sm.id = s.meeting_id
  WHERE NOT (sm.manager_id = cm.manager_id AND sm.subordinate_id = cm.subordinate_id
             AND sm.meeting_date < cm.meeting_date AND s.resolved = false);
INSERT INTO verify_checks SELECT 'every meeting has exactly one CREATED event', count(*) FROM one_on_one_meetings m
  WHERE (SELECT count(*) FROM one_on_one_events e WHERE e.meeting_id = m.id AND e.event_type = 'CREATED') <> 1;

-- 5. Feedback invariants (feedbacks.md): position-0 anchor, provider never a recipient, <= 4 recipients, requested
--    rows single-recipient with a requester, visibility/requester coherence, no duplicate open row per (provider, recipient).
INSERT INTO verify_checks SELECT 'feedbacks.subject_id is the position-0 recipient', count(*) FROM feedbacks f
  WHERE NOT EXISTS (SELECT 1 FROM feedback_subjects s WHERE s.feedback_id = f.id AND s.position = 0 AND s.user_id = f.subject_id);
INSERT INTO verify_checks SELECT 'the provider is never a recipient', count(*) FROM feedbacks f
  JOIN feedback_subjects s ON s.feedback_id = f.id WHERE s.user_id = f.provider_id;
INSERT INTO verify_checks SELECT 'at most four recipients per feedback', count(*) FROM (
  SELECT 1 FROM feedback_subjects GROUP BY feedback_id HAVING count(*) > 4) d;
INSERT INTO verify_checks SELECT 'a requested feedback has a requester and exactly one recipient', count(*) FROM feedbacks f
  WHERE f.status = 'REQUESTED' AND (f.requester_id IS NULL OR (SELECT count(*) FROM feedback_subjects s WHERE s.feedback_id = f.id) <> 1);
INSERT INTO verify_checks SELECT 'a feedback with a requester never uses PROVIDER_SUBJECT; PROVIDER_REQUESTER needs a requester', count(*) FROM feedbacks f
  WHERE (f.requester_id IS NOT NULL AND f.visibility = 'PROVIDER_SUBJECT')
     OR (f.requester_id IS NULL AND f.visibility = 'PROVIDER_REQUESTER');
INSERT INTO verify_checks SELECT 'no two open (DRAFT/REQUESTED) feedbacks of one provider share a recipient', count(*) FROM (
  SELECT 1 FROM feedbacks f JOIN feedback_subjects s ON s.feedback_id = f.id
  WHERE f.status IN ('DRAFT', 'REQUESTED') AND NOT f.marked_as_deleted
  GROUP BY f.provider_id, f.requester_id, s.user_id HAVING count(*) > 1) d;

-- 6. Goals: type-specific fields (goals.md) and PLAN/ACTIVE shape.
INSERT INTO verify_checks SELECT 'PLAN goals carry no target/current value; numeric goals carry a target', count(*) FROM goals
  WHERE (type = 'PLAN' AND (target_value IS NOT NULL OR current_value IS NOT NULL OR target_direction IS NOT NULL))
     OR (type <> 'PLAN' AND (target_value IS NULL OR target_direction IS NULL));
INSERT INTO verify_checks SELECT 'a DRAFT goal has no recorded progress', count(*) FROM goals g
  WHERE g.status = 'DRAFT' AND (g.current_value IS NOT NULL OR EXISTS (SELECT 1 FROM goal_milestones m WHERE m.goal_id = g.id AND m.done));

-- 7. Pulse (pulse-surveys.md): at most one non-terminal cycle, CLOSED <=> closed_at, a participant snapshot per cycle,
--    every response belongs to a participant of its cycle.
INSERT INTO verify_checks SELECT 'pulse: at most one non-terminal (SCHEDULED/OPEN) cycle', count(*) FROM (
  SELECT 1 FROM pulse_cycles WHERE status IN ('SCHEDULED', 'OPEN') HAVING count(*) > 1) d;
INSERT INTO verify_checks SELECT 'pulse: closed_at is set exactly on CLOSED cycles', count(*) FROM pulse_cycles
  WHERE (status = 'CLOSED') <> (closed_at IS NOT NULL);
INSERT INTO verify_checks SELECT 'pulse: every cycle has a participant snapshot', count(*) FROM pulse_cycles c
  WHERE NOT EXISTS (SELECT 1 FROM pulse_participants p WHERE p.cycle_id = c.id);
INSERT INTO verify_checks SELECT 'pulse: every response belongs to a participant of its cycle', count(*) FROM pulse_responses r
  WHERE NOT EXISTS (SELECT 1 FROM pulse_participants p WHERE p.cycle_id = r.cycle_id AND p.user_id = r.user_id);

-- 8. Team KPIs (team-kpis.md): the denormalized current value is the max-dated data point; percentages stay in 0..100.
INSERT INTO verify_checks SELECT 'team KPI current value/date equal the max-dated data point (0.0/null when none)', count(*) FROM team_kpis k
  WHERE k.current_value IS DISTINCT FROM COALESCE((SELECT v.value FROM team_kpi_values v WHERE v.team_kpi_id = k.id ORDER BY v.value_date DESC LIMIT 1), 0)
     OR k.current_value_date IS DISTINCT FROM (SELECT max(v.value_date) FROM team_kpi_values v WHERE v.team_kpi_id = k.id);
INSERT INTO verify_checks SELECT 'PERCENTAGE team KPI values and targets lie in 0..100', count(*) FROM team_kpis k
  WHERE k.type = 'PERCENTAGE' AND (k.target_value NOT BETWEEN 0 AND 100
     OR EXISTS (SELECT 1 FROM team_kpi_values v WHERE v.team_kpi_id = k.id AND v.value NOT BETWEEN 0 AND 100));
INSERT INTO verify_checks SELECT 'every team KPI is created by its team''s manager and has a CREATED event', count(*) FROM team_kpis k
  WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = k.team_id AND t.manager_id = k.created_by)
     OR (SELECT count(*) FROM team_kpi_events e WHERE e.team_kpi_id = k.id AND e.event_type = 'CREATED') <> 1;

-- 9. Days off (days-off.md): costs are positive and one calendar year, no overlap per person, a PAID entry draws on an
--    active grant of its person, and each (person, pool, year) stays inside 2 x allowance (the app's create-time 409).
INSERT INTO verify_checks SELECT 'days-off: cost > 0, start <= end, one calendar year, PAID entries name a pool', count(*) FROM days_off_requests
  WHERE cost_half_days <= 0 OR start_date > end_date OR left(start_date, 4) <> left(end_date, 4)
     OR (type = 'PAID' AND pool_type_id IS NULL);
INSERT INTO verify_checks SELECT 'days-off: a single-day entry has no end half-day (DaysOff.kt rejects start = end AND end_half)', count(*) FROM days_off_requests
  WHERE start_date = end_date AND end_half;
INSERT INTO verify_checks SELECT 'days-off: no two active entries of one person overlap', count(*) FROM days_off_requests a
  JOIN days_off_requests b ON b.user_id = a.user_id AND a.id < b.id AND a.start_date <= b.end_date AND a.end_date >= b.start_date
  WHERE NOT a.marked_as_deleted AND NOT b.marked_as_deleted;
INSERT INTO verify_checks SELECT 'days-off: every PAID entry has an active grant of its pool for the person', count(*) FROM days_off_requests r
  WHERE r.type = 'PAID' AND NOT EXISTS (SELECT 1 FROM days_off_pools p WHERE p.user_id = r.user_id AND p.pool_type_id = r.pool_type_id AND NOT p.marked_as_deleted);
INSERT INTO verify_checks SELECT 'days-off: per (person, pool, year) the active cost stays within 2 x allowance', count(*) FROM (
  SELECT r.user_id, r.pool_type_id, left(r.start_date, 4) AS yr, sum(r.cost_half_days) AS used, max(p.allowance) AS allowance
  FROM days_off_requests r JOIN days_off_pools p ON p.user_id = r.user_id AND p.pool_type_id = r.pool_type_id AND NOT p.marked_as_deleted
  WHERE NOT r.marked_as_deleted AND r.type = 'PAID' GROUP BY 1, 2, 3) u WHERE u.used > 2 * u.allowance;
INSERT INTO verify_checks SELECT 'days-off: one ENTRY_RECORDED event per entry, one ENTRY_DELETED per deleted entry',
  abs((SELECT count(*) FROM days_off_events WHERE event_type = 'ENTRY_RECORDED') - (SELECT count(*) FROM days_off_requests))
  + abs((SELECT count(*) FROM days_off_events WHERE event_type = 'ENTRY_DELETED') - (SELECT count(*) FROM days_off_requests WHERE marked_as_deleted));

-- 10. Impact log (impact-log.md): period start <= end, one entry per (person, month), one CREATED event per entry.
INSERT INTO verify_checks SELECT 'impact log: period_start <= period_end, one entry per (person, period)', count(*) FROM (
  SELECT 1 FROM impact_log_entries WHERE period_start > period_end
  UNION ALL SELECT 1 FROM (SELECT user_id, period_start FROM impact_log_entries GROUP BY 1, 2 HAVING count(*) > 1) x) d;
INSERT INTO verify_checks SELECT 'impact log: every entry has exactly one CREATED event', count(*) FROM impact_log_entries e
  WHERE (SELECT count(*) FROM impact_log_events v WHERE v.entry_id = e.id AND v.event_type = 'CREATED') <> 1;

-- 11. Succession (succession-plans.md): the seat's person sits in the owner's transitive chain, the candidate is never the
--     seat's person, at most one PRIMARY per plan, one OPEN plan per (owner, person), the plan carries a CREATED event.
WITH RECURSIVE reports(manager_id, user_id) AS (
  SELECT t.manager_id, tm.user_id FROM teams t JOIN team_members tm ON tm.team_id = t.id WHERE NOT t.marked_as_deleted
  UNION
  SELECT r.manager_id, tm.user_id FROM reports r JOIN teams t ON t.manager_id = r.user_id AND NOT t.marked_as_deleted
  JOIN team_members tm ON tm.team_id = t.id)
INSERT INTO verify_checks SELECT 'succession: the seat''s person is in the owner''s transitive chain', count(*) FROM succession_plans p
  WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.manager_id = p.manager_id AND r.user_id = p.user_id);
INSERT INTO verify_checks SELECT 'succession: candidate is not the seat''s person; at most one PRIMARY per plan', count(*) FROM (
  SELECT 1 FROM succession_nominations n JOIN succession_plans p ON p.id = n.plan_id WHERE n.candidate_id = p.user_id
  UNION ALL SELECT 1 FROM (SELECT plan_id FROM succession_nominations WHERE nomination_type = 'PRIMARY' AND NOT marked_as_deleted GROUP BY 1 HAVING count(*) > 1) x) d;
WITH RECURSIVE reports(manager_id, user_id) AS (
  SELECT t.manager_id, tm.user_id FROM teams t JOIN team_members tm ON tm.team_id = t.id WHERE NOT t.marked_as_deleted
  UNION
  SELECT r.manager_id, tm.user_id FROM reports r JOIN teams t ON t.manager_id = r.user_id AND NOT t.marked_as_deleted
  JOIN team_members tm ON tm.team_id = t.id)
INSERT INTO verify_checks SELECT 'succession: a candidate is never the plan''s owner nor anyone above the seat''s person', count(*) FROM succession_nominations n
  JOIN succession_plans p ON p.id = n.plan_id
  WHERE n.candidate_id = p.manager_id
     OR EXISTS (SELECT 1 FROM reports r WHERE r.manager_id = n.candidate_id AND r.user_id = p.user_id);
INSERT INTO verify_checks SELECT 'succession: one OPEN plan per (owner, person); every plan has a CREATED event', count(*) FROM (
  SELECT 1 FROM (SELECT manager_id, user_id FROM succession_plans WHERE status = 'OPEN' AND NOT marked_as_deleted GROUP BY 1, 2 HAVING count(*) > 1) x
  UNION ALL SELECT 1 FROM succession_plans p WHERE (SELECT count(*) FROM succession_plan_events e WHERE e.plan_id = p.id AND e.event_type = 'CREATED') <> 1) d;

-- 12. Shares (sharing.md): the sharer is the document's author (the own-right reader who may share it), details snapshot
--     present, no duplicate (document, sharee).
INSERT INTO verify_checks SELECT 'shares: the sharer is the author of the shared document', count(*) FROM document_shares s
  WHERE NOT CASE s.resource_type
    WHEN 'FEEDBACK' THEN EXISTS (SELECT 1 FROM feedbacks d WHERE d.id = s.resource_id AND d.provider_id = s.sharer_id)
    WHEN 'ONE_ON_ONE' THEN EXISTS (SELECT 1 FROM one_on_one_meetings d WHERE d.id = s.resource_id AND d.manager_id = s.sharer_id)
    WHEN 'GOAL' THEN EXISTS (SELECT 1 FROM goals d WHERE d.id = s.resource_id AND d.manager_id = s.sharer_id)
    WHEN 'PERFORMANCE_REVIEW' THEN EXISTS (SELECT 1 FROM performance_reviews d WHERE d.id = s.resource_id AND d.manager_id = s.sharer_id)
    WHEN 'IMPACT_LOG_ENTRY' THEN EXISTS (SELECT 1 FROM impact_log_entries d WHERE d.id = s.resource_id AND d.user_id = s.sharer_id)
    WHEN 'SUCCESSION_PLAN' THEN EXISTS (SELECT 1 FROM succession_plans d WHERE d.id = s.resource_id AND d.manager_id = s.sharer_id)
    WHEN 'TEAM_KPI' THEN EXISTS (SELECT 1 FROM team_kpis d JOIN teams t ON t.id = d.team_id WHERE d.id = s.resource_id AND t.manager_id = s.sharer_id)
    WHEN 'DAYS_OFF_CALENDAR' THEN s.resource_id = s.sharer_id
    WHEN 'PULSE_TEAM_RESULTS' THEN EXISTS (SELECT 1 FROM teams t WHERE t.id = s.resource_id AND t.manager_id = s.sharer_id)
    ELSE FALSE END;
INSERT INTO verify_checks SELECT 'shares: details snapshot present, no duplicate (document, sharee)', count(*) FROM (
  SELECT 1 FROM document_shares WHERE details IS NULL
  UNION ALL SELECT 1 FROM (SELECT resource_type, resource_id, sharee_id FROM document_shares GROUP BY 1, 2, 3 HAVING count(*) > 1) x) d;

-- 13. Person-keyed trails (V88-V90): career-position events name a position of their owner; the sign-in history
--     keeps only its 90-day retention window and is owner = actor.
INSERT INTO verify_checks SELECT 'career_position_events: the named position belongs to the event''s owner', count(*) FROM career_position_events e
  WHERE NOT EXISTS (SELECT 1 FROM user_career_positions p WHERE p.id = (e.params::jsonb ->> 'positionId')::bigint AND p.user_id = e.owner_id);
INSERT INTO verify_checks SELECT 'account_events: owner = actor, nothing older than the 90-day window', count(*) FROM account_events
  WHERE user_id IS DISTINCT FROM owner_id OR created_at < (SELECT max(created_at) FROM account_events) - 91::bigint * 86400000;

-- The sign-in history and users.last_login_at agree: a perf account that never signed in has no SIGNED_IN row and
-- last_login_at = 0, every other one's last_login_at is its newest SIGNED_IN.
INSERT INTO verify_checks SELECT 'users.last_login_at equals the newest SIGNED_IN of the account (0 when none)', count(*) FROM users u
  WHERE u.email LIKE '%@perf.lettuce.local'
    AND u.last_login_at <> COALESCE((SELECT max(e.created_at) FROM account_events e WHERE e.owner_id = u.id AND e.event_type = 'SIGNED_IN'), 0);

-- 13b. Timestamp pile-ups: the generator scatters "would be in the future" moments over the last 30 days before the anchor
--      (SeedContext.spreadMillis) instead of clamping them onto one millisecond. No event / share / notification
--      timestamp may be shared by more than 20 rows. Notifications group by (moment, type) — one event legitimately mints
--      one notice per recipient — and leave out the four pulse cycle fan-outs, which notify the whole eligible org at once.
DO $$
DECLARE c record; worst bigint;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('feedback_events', 'created_at', 'true'), ('one_on_one_events', 'created_at', 'true'), ('goal_events', 'created_at', 'true'),
    ('team_kpi_events', 'created_at', 'true'), ('performance_review_events', 'created_at', 'true'),
    ('impact_log_events', 'created_at', 'true'), ('succession_plan_events', 'created_at', 'true'),
    ('days_off_events', 'created_at', 'true'), ('career_position_events', 'created_at', 'true'),
    ('account_events', 'created_at', 'true'), ('document_shares', 'created_at', 'true'),
    ('document_shares', 'withdrawn_at', 'withdrawn_at IS NOT NULL'),
    ('days_off_requests', 'created_at', 'true'), ('days_off_corrections', 'created_at', 'true'),
    ('succession_plans', 'last_reviewed_at', 'true')
  ) AS t(tbl, col, cond) LOOP
    EXECUTE format('SELECT COALESCE(max(k), 0) FROM (SELECT count(*) AS k FROM %I WHERE %s GROUP BY %I) g', c.tbl, c.cond, c.col) INTO worst;
    INSERT INTO verify_checks VALUES (format('same-millisecond groups: largest %s.%s group is at most 20', c.tbl, c.col), CASE WHEN worst > 20 THEN worst ELSE 0 END);
  END LOOP;
  SELECT COALESCE(max(k), 0) INTO worst FROM (
    SELECT count(*) AS k FROM notifications
    WHERE notification_type NOT IN ('PULSE_CYCLE_SCHEDULED', 'PULSE_CYCLE_OPENED', 'PULSE_RESULTS_AVAILABLE', 'PULSE_CYCLE_CANCELLED')
    GROUP BY created_at, notification_type) g;
  INSERT INTO verify_checks VALUES ('same-millisecond groups: largest notifications (moment, type) group is at most 20', CASE WHEN worst > 20 THEN worst ELSE 0 END);
END $$;

-- 14. Referential sanity the foreign keys cannot say: the sequences are ahead of the generated ids
--    (the app's next INSERT must not collide).
DO $$
DECLARE t text; seq text; n bigint; mx bigint; bad bigint := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'teams', 'dictionary_entries', 'user_career_positions', 'review_periods',
    'performance_reviews', 'performance_review_events', 'one_on_one_meetings', 'one_on_one_notes',
    'one_on_one_action_items', 'one_on_one_events', 'goals', 'goal_milestones', 'goal_events', 'feedbacks',
    'feedback_events', 'notifications', 'pulse_cycles', 'pulse_responses', 'team_kpis', 'team_kpi_values', 'team_kpi_events',
    'public_holidays', 'days_off_pool_types', 'days_off_pools', 'days_off_requests', 'days_off_corrections', 'days_off_events',
    'impact_log_entries', 'impact_log_events', 'succession_plans', 'succession_nominations', 'succession_plan_events',
    'document_shares', 'career_position_events', 'account_events'] LOOP
    seq := pg_get_serial_sequence(t, 'id');
    EXECUTE format('SELECT COALESCE(max(id), 0) FROM %I', t) INTO mx;
    EXECUTE format('SELECT last_value FROM %s', seq) INTO n;
    IF n < mx THEN bad := bad + 1; RAISE WARNING 'sequence of % is behind max(id): % < %', t, n, mx; END IF;
  END LOOP;
  INSERT INTO verify_checks VALUES ('serial sequences are at or beyond max(id)', bad);
END $$;

-- Report + gate.
SELECT CASE WHEN violations = 0 THEN 'ok   ' ELSE 'FAIL ' END || name || CASE WHEN violations = 0 THEN '' ELSE '  (' || violations || ' violation(s))' END AS verify
FROM verify_checks ORDER BY violations DESC, name;

DO $$
DECLARE failed bigint;
BEGIN
  SELECT count(*) INTO failed FROM verify_checks WHERE violations > 0;
  IF failed > 0 THEN RAISE EXCEPTION 'perf/pg/verify.sql: % check(s) failed', failed; END IF;
  RAISE NOTICE 'perf/pg/verify.sql: all % checks passed', (SELECT count(*) FROM verify_checks);
END $$;

-- Row counts for the record (compare with perf/results/seed-<version>.json).
SELECT 'users' AS "table", count(*) FROM users
UNION ALL SELECT 'teams', count(*) FROM teams
UNION ALL SELECT 'review_periods', count(*) FROM review_periods
UNION ALL SELECT 'performance_reviews', count(*) FROM performance_reviews
UNION ALL SELECT 'one_on_one_meetings', count(*) FROM one_on_one_meetings
UNION ALL SELECT 'one_on_one_notes', count(*) FROM one_on_one_notes
UNION ALL SELECT 'one_on_one_action_items', count(*) FROM one_on_one_action_items
UNION ALL SELECT 'goals', count(*) FROM goals
UNION ALL SELECT 'feedbacks', count(*) FROM feedbacks
UNION ALL SELECT 'notifications', count(*) FROM notifications
UNION ALL SELECT 'pulse_cycles', count(*) FROM pulse_cycles
UNION ALL SELECT 'pulse_participants', count(*) FROM pulse_participants
UNION ALL SELECT 'pulse_responses', count(*) FROM pulse_responses
UNION ALL SELECT 'team_kpis', count(*) FROM team_kpis
UNION ALL SELECT 'team_kpi_values', count(*) FROM team_kpi_values
UNION ALL SELECT 'team_kpi_events', count(*) FROM team_kpi_events
UNION ALL SELECT 'public_holidays', count(*) FROM public_holidays
UNION ALL SELECT 'days_off_pools', count(*) FROM days_off_pools
UNION ALL SELECT 'days_off_requests', count(*) FROM days_off_requests
UNION ALL SELECT 'days_off_corrections', count(*) FROM days_off_corrections
UNION ALL SELECT 'days_off_events', count(*) FROM days_off_events
UNION ALL SELECT 'impact_log_entries', count(*) FROM impact_log_entries
UNION ALL SELECT 'impact_log_events', count(*) FROM impact_log_events
UNION ALL SELECT 'succession_plans', count(*) FROM succession_plans
UNION ALL SELECT 'succession_nominations', count(*) FROM succession_nominations
UNION ALL SELECT 'succession_nomination_goals', count(*) FROM succession_nomination_goals
UNION ALL SELECT 'succession_plan_events', count(*) FROM succession_plan_events
UNION ALL SELECT 'document_shares', count(*) FROM document_shares
UNION ALL SELECT 'career_position_events', count(*) FROM career_position_events
UNION ALL SELECT 'account_events', count(*) FROM account_events
UNION ALL SELECT 'database size', pg_database_size(current_database())
ORDER BY 1;
