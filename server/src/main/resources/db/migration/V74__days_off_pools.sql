-- Multiple paid days-off pools (v3.2.0): a user may hold SEVERAL paid pools — the default
-- one plus named extras ("Maternal leave", 3 days) — each with its own allowance and its own
-- budget history; every PAID request and every correction targets exactly one pool. UNPAID
-- stays the single unlimited type and references no pool.
--
-- Two new tables:
--   * days_off_pool_types — the ORG-WIDE registry of pool kinds (ADMIN-managed, the
--     public-holidays posture): a name, whether unused days carry over year to year, and the
--     single seeded default (is_default). Soft-deleting ("archived"): an archived kind can no
--     longer be granted or targeted, but history keeps its label (name lookups never filter on
--     the flag). Name uniqueness is a partial index over active rows (the templates idiom).
--   * days_off_pools — the PER-USER grants (a chain manager's right, PUT /days-off/allowance):
--     (user, pool type) → allowance. Soft-deleting ("archived"): an archived grant is invisible
--     to every read; re-granting the same type INSERTS a new row (the partial unique index
--     permits it) and the pool's history — keyed on (user_id, pool_type_id) in the requests
--     and corrections tables, NOT on the grant row — simply continues.
--
-- The default kind is inserted WITHOUT an explicit id (a seeded id would leave the BIGSERIAL
-- sequence at 1 and 23505 the first admin POST); every backfill resolves it via a subselect.
-- users.paid_days_off_allowance (V38) moves into days_off_pools as the default-kind grant and
-- the column is dropped (V38's file stays untouched — checksums).

CREATE TABLE days_off_pool_types (
    id                BIGSERIAL    PRIMARY KEY,
    name              VARCHAR(100) NOT NULL,
    carries_over      BOOLEAN      NOT NULL,
    is_default        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at        BIGINT       NOT NULL,
    last_modified     BIGINT       NOT NULL,
    marked_as_deleted BOOLEAN      NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX uq_days_off_pool_types_name_active
    ON days_off_pool_types(name) WHERE marked_as_deleted = false;
CREATE UNIQUE INDEX uq_days_off_pool_types_default
    ON days_off_pool_types(is_default) WHERE is_default AND marked_as_deleted = false;
CREATE INDEX idx_days_off_pool_types_marked_as_deleted ON days_off_pool_types(marked_as_deleted);

INSERT INTO days_off_pool_types (name, carries_over, is_default, created_at, last_modified)
VALUES (
    'Paid days off',
    TRUE,
    TRUE,
    (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
    (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

CREATE TABLE days_off_pools (
    id                BIGSERIAL PRIMARY KEY,
    user_id           BIGINT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    pool_type_id      BIGINT    NOT NULL REFERENCES days_off_pool_types(id) ON DELETE RESTRICT,
    allowance         INTEGER   NOT NULL CHECK (allowance BETWEEN 0 AND 365),
    created_at        BIGINT    NOT NULL,
    last_modified     BIGINT    NOT NULL,
    marked_as_deleted BOOLEAN   NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX uq_days_off_pools_user_type_active
    ON days_off_pools(user_id, pool_type_id) WHERE marked_as_deleted = false;
CREATE INDEX idx_days_off_pools_user_id ON days_off_pools(user_id);

-- Backfill: every configured allowance becomes the user's default-kind grant.
INSERT INTO days_off_pools (user_id, pool_type_id, allowance, created_at, last_modified)
SELECT
    id,
    (SELECT id FROM days_off_pool_types WHERE is_default),
    paid_days_off_allowance,
    (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
    (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
FROM users
WHERE paid_days_off_allowance IS NOT NULL;

ALTER TABLE users DROP COLUMN paid_days_off_allowance;

-- Requests: PAID rows target a pool kind, UNPAID rows never do (the CHECK pins the pairing;
-- added AFTER the backfill so the existing PAID rows already satisfy it).
ALTER TABLE days_off_requests ADD COLUMN pool_type_id BIGINT NULL REFERENCES days_off_pool_types(id);
UPDATE days_off_requests
SET pool_type_id = (SELECT id FROM days_off_pool_types WHERE is_default)
WHERE type = 'PAID';
ALTER TABLE days_off_requests
    ADD CONSTRAINT ck_days_off_requests_pool CHECK ((type = 'PAID') = (pool_type_id IS NOT NULL));
CREATE INDEX idx_days_off_requests_pool_type_id ON days_off_requests(pool_type_id);

-- Corrections: every correction adjusts exactly one pool; the existing ones adjusted the
-- only pool there was.
ALTER TABLE days_off_corrections ADD COLUMN pool_type_id BIGINT NULL REFERENCES days_off_pool_types(id);
UPDATE days_off_corrections
SET pool_type_id = (SELECT id FROM days_off_pool_types WHERE is_default);
ALTER TABLE days_off_corrections ALTER COLUMN pool_type_id SET NOT NULL;
