-- Progress updates on an ACTIVE goal (now open to both parties, v2.8.0) may carry an optional
-- free-text comment shown in the goal's history. Free text must never land in the plaintext
-- params JSON (the V45 scrub precedent), so the comment gets its own column, encrypted at rest
-- by the application (the days_off_corrections.comment precedent). NULL = no comment.
ALTER TABLE goal_events ADD COLUMN comment TEXT NULL;
