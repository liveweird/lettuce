-- Goals: the BINARY type (one achieved flag) is rebuilt into PLAN (v2.9.0) — an ordered list of
-- milestones, each a text description plus a done flag. Milestones are defined by the manager
-- while DRAFT (part of the definition PUT, action-items-style whole-list replace) and ticked by
-- either party while ACTIVE (the progress PUT). Rows hard-delete on replace like the 1:1 detail
-- tables; the CASCADE never fires (goals soft-delete).
CREATE TABLE goal_milestones (
    id          BIGSERIAL PRIMARY KEY,
    goal_id     BIGINT    NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    position    INT       NOT NULL,
    description TEXT      NOT NULL,  -- encrypted at rest (enc:v1:…), never filtered/sorted in SQL
    done        BOOLEAN   NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_goal_milestones_goal_id ON goal_milestones(goal_id);

-- Type rename BINARY -> PLAN (the V37 idiom: the V25 CHECK must drop before the data rewrite
-- and return naming the new value).
ALTER TABLE goals DROP CONSTRAINT goals_type_check;
UPDATE goals SET type = 'PLAN' WHERE type = 'BINARY';
ALTER TABLE goals ADD CONSTRAINT goals_type_check
    CHECK (type IN ('PLAN', 'NUMBER', 'PERCENTAGE'));

-- Conversion: every ex-BINARY goal (soft-deleted included) gets one synthesized milestone whose
-- done state carries the old achieved flag forward (never-recorded null = not done). The
-- plaintext 'Done' is encrypted by the bootstrap encryptLegacyRows backfill at first boot —
-- the established legacy-plaintext path.
INSERT INTO goal_milestones (goal_id, position, description, done)
SELECT id, 0, 'Done', COALESCE(achieved, FALSE)
FROM goals
WHERE type = 'PLAN';

-- No type uses the flag anymore.
ALTER TABLE goals DROP COLUMN achieved;

-- The audit trail stores CREATED/TYPE_CHANGED params as a JSON object of enum names only
-- ({"type":...} / {"from":...,"to":...}), so a plain string replace is exact (the V37 idiom) —
-- the SPA then needs no legacy BINARY label.
UPDATE goal_events
SET params = REPLACE(params, '"BINARY"', '"PLAN"')
WHERE event_type IN ('CREATED', 'TYPE_CHANGED') AND params LIKE '%"BINARY"%';
