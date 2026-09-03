-- Checkup #32 (v3.2.1): index hygiene for the paid pools. V74's idx_days_off_pools_user_id
-- duplicated the leading column of uq_days_off_pools_user_type_active (every read of a
-- user's grants is an active-row read, which the partial unique index serves), while the ONE
-- scan nothing indexed — archiving a pool KIND cascades over every grant of that kind
-- (WHERE pool_type_id = ? AND marked_as_deleted = false) — gets its own index here.
DROP INDEX idx_days_off_pools_user_id;
CREATE INDEX idx_days_off_pools_pool_type_id_active
    ON days_off_pools(pool_type_id) WHERE marked_as_deleted = false;
