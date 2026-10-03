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
    -- not seeded by M1 (empty tables pass trivially); listed so M2's generator is held to the same rule
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

-- 7. Referential sanity the foreign keys cannot say: the sequences are ahead of the generated ids
--    (the app's next INSERT must not collide).
DO $$
DECLARE t text; seq text; n bigint; mx bigint; bad bigint := 0;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'teams', 'dictionary_entries', 'user_career_positions', 'review_periods',
    'performance_reviews', 'performance_review_events', 'one_on_one_meetings', 'one_on_one_notes',
    'one_on_one_action_items', 'one_on_one_events', 'goals', 'goal_milestones', 'goal_events', 'feedbacks',
    'feedback_events', 'notifications'] LOOP
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
UNION ALL SELECT 'database size', pg_database_size(current_database())
ORDER BY 1;
