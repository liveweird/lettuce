-- Per-user activity log (v4.9.0, step 1 — see activity/ and .claude/docs/features/activity-log.md):
-- "what did this person do, in order" is a UNION ALL read model over the seven per-record
-- `*_events` tables (no new table, no dual write), filtered on the ACTING user and ordered by
-- time. The seven tables only ever indexed their owning-record FK, so each branch of that union
-- would otherwise be a full scan; a (user_id, created_at) index turns every branch into one index
-- range scan. `user_id` is nullable since V80 (system-originated events) — a NULL actor is never
-- anyone's activity and simply is not in the index range a `user_id = ?` probe reads.
CREATE INDEX idx_feedback_events_user_created           ON feedback_events(user_id, created_at);
CREATE INDEX idx_one_on_one_events_user_created         ON one_on_one_events(user_id, created_at);
CREATE INDEX idx_goal_events_user_created               ON goal_events(user_id, created_at);
CREATE INDEX idx_team_kpi_events_user_created           ON team_kpi_events(user_id, created_at);
CREATE INDEX idx_performance_review_events_user_created ON performance_review_events(user_id, created_at);
CREATE INDEX idx_impact_log_events_user_created         ON impact_log_events(user_id, created_at);
CREATE INDEX idx_succession_plan_events_user_created    ON succession_plan_events(user_id, created_at);

-- The share-withdrawal rows of the activity log (step 3) read `document_shares` by the
-- WITHDRAWER; sharer_id is already covered by V86's indexes, withdrawn_by is not. Partial: most
-- shares are never withdrawn.
CREATE INDEX idx_document_shares_withdrawn_by ON document_shares(withdrawn_by, withdrawn_at) WHERE withdrawn_by IS NOT NULL;
