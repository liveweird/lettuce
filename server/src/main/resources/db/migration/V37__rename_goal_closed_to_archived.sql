-- Goals' terminal status renames CLOSED -> ARCHIVED (v1.41.0), aligning with team KPIs'
-- DRAFT <-> ACTIVE <-> ARCHIVED machine ("closed" read like closing a window). Three stores
-- carry the literal enum name and are rewritten together; order matters — the V25 CHECK
-- must drop before the data rewrite and return naming the new value.
ALTER TABLE goals DROP CONSTRAINT goals_status_check;
UPDATE goals SET status = 'ARCHIVED' WHERE status = 'CLOSED';
ALTER TABLE goals ADD CONSTRAINT goals_status_check
    CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'));

-- The audit trail stores STATUS_CHANGED params as a JSON object of enum names only
-- ({"from":...,"to":...}), so a plain string replace is exact.
UPDATE goal_events
SET params = REPLACE(params, '"CLOSED"', '"ARCHIVED"')
WHERE event_type = 'STATUS_CHANGED' AND params LIKE '%"CLOSED"%';

-- Stored notification rows carry the type name; V13 has no CHECK on it.
UPDATE notifications
SET notification_type = 'GOAL_ARCHIVED_TO_SUBORDINATE'
WHERE notification_type = 'GOAL_CLOSED_TO_SUBORDINATE';
