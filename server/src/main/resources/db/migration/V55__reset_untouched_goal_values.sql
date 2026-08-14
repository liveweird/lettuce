-- v2.8.1: goals no longer auto-initialize their current value to the type's zero — a fresh
-- goal has NO recorded value (NULL) until the first progress update. This resets the
-- auto-initialized values of existing goals whose value was never actually set by anyone:
-- a goal with no progress event in its history still carries the creation-time 0.0 / FALSE.
-- Heuristic, deliberately conservative: a goal whose type was changed AFTER real progress
-- updates keeps its re-initialized zero (it has progress events), and a deliberately recorded
-- zero / "not achieved" always survives (it minted an event). Soft-deleted rows included.
UPDATE goals SET current_value = NULL
WHERE current_value = 0.0
  AND type IN ('NUMBER', 'PERCENTAGE')
  AND NOT EXISTS (
    SELECT 1 FROM goal_events e
    WHERE e.goal_id = goals.id AND e.event_type = 'PROGRESS_UPDATED'
  );

UPDATE goals SET achieved = NULL
WHERE achieved = FALSE
  AND type = 'BINARY'
  AND NOT EXISTS (
    SELECT 1 FROM goal_events e
    WHERE e.goal_id = goals.id AND e.event_type = 'ACHIEVED_CHANGED'
  );
