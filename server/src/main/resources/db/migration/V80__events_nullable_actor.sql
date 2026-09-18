-- System actor (v3.11.0/V80): the seven per-record `*_events` tables (feedback/1:1/goal/
-- team-KPI/performance-review/impact-log/succession-plan, all V15/V70 EventLogTable clones)
-- stored `user_id` NOT NULL, so a system-originated event (the v3.8.0 REQUEST_EXPIRED lazy
-- expiry sweep) had no honest actor to record and was attributed to the feedback's provider
-- purely because the column disallowed NULL. Drop that constraint so a system event can store
-- NULL — the client renders a generic "Automatic" label off a null actor. The FKs are
-- untouched (a nullable FK column still enforces referential integrity for non-null values).
ALTER TABLE feedback_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE one_on_one_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE goal_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE team_kpi_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE performance_review_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE impact_log_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE succession_plan_events ALTER COLUMN user_id DROP NOT NULL;

-- Re-attribute the historical REQUEST_EXPIRED rows to the system actor now that NULL is
-- possible — they were only ever stamped against the provider as a NOT NULL workaround.
UPDATE feedback_events SET user_id = NULL WHERE event_type = 'REQUEST_EXPIRED';
