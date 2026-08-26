-- One PRIMARY nomination per plan (v2.43.0): a plan's bench has at most one active PRIMARY
-- successor. The service enforces it by demoting the existing PRIMARY to SECONDARY inside the
-- same transaction as any nomination write that sets PRIMARY (the SPA asks the owner to confirm
-- the demotion first).

-- Normalize pre-rule data: per plan, the most recently modified active PRIMARY wins (the latest
-- decision), the rest become SECONDARY.
UPDATE succession_nominations SET nomination_type = 'SECONDARY'
WHERE nomination_type = 'PRIMARY' AND marked_as_deleted = FALSE
  AND id NOT IN (
    SELECT DISTINCT ON (plan_id) id FROM succession_nominations
    WHERE nomination_type = 'PRIMARY' AND marked_as_deleted = FALSE
    ORDER BY plan_id, last_modified DESC, id DESC
  );

-- The service demotes in-transaction; this index is the concurrent-write backstop (23505 -> 409).
CREATE UNIQUE INDEX uq_succession_nominations_plan_primary
    ON succession_nominations(plan_id)
    WHERE marked_as_deleted = FALSE AND nomination_type = 'PRIMARY';
