-- Performance reviews: a manager assesses a direct report for one review period (V34) across
-- four categories — attitude, delivery, skills, overall — each a 1-6 rating plus a text summary.
-- Status machine DRAFT <-> CALIBRATION <-> PUBLISHED (both directions, never skipping
-- CALIBRATION); every change is recorded in performance_review_events (V36). The review row is
-- the soft-delete unit (DRAFT-only via the API). Ratings may be NULL while DRAFT (a partial
-- draft); entering CALIBRATION requires all four categories complete. The summary columns are
-- encrypted at rest (enc:v1:...) and never filtered/sorted in SQL; the ratings stay plaintext
-- numerics on purpose — lists carry them and calculations run on them. The partial unique index
-- enforces the business rule that a subordinate has at most ONE active review per period, at any
-- status; a soft-deleted review frees the slot.
CREATE TABLE performance_reviews (
    id                BIGSERIAL   PRIMARY KEY,
    manager_id        BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    subordinate_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    period_id         BIGINT      NOT NULL REFERENCES review_periods(id) ON DELETE RESTRICT,
    created_at        BIGINT      NOT NULL,  -- epoch millis, immutable
    status            VARCHAR(20) NOT NULL CHECK (status IN ('DRAFT', 'CALIBRATION', 'PUBLISHED')),
    attitude_rating   SMALLINT    NULL CHECK (attitude_rating BETWEEN 1 AND 6),
    attitude_summary  TEXT        NULL,      -- encrypted at rest
    delivery_rating   SMALLINT    NULL CHECK (delivery_rating BETWEEN 1 AND 6),
    delivery_summary  TEXT        NULL,      -- encrypted at rest
    skills_rating     SMALLINT    NULL CHECK (skills_rating BETWEEN 1 AND 6),
    skills_summary    TEXT        NULL,      -- encrypted at rest
    overall_rating    SMALLINT    NULL CHECK (overall_rating BETWEEN 1 AND 6),
    overall_summary   TEXT        NULL,      -- encrypted at rest
    last_modified     BIGINT      NOT NULL,
    marked_as_deleted BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_performance_reviews_manager_id ON performance_reviews(manager_id);
CREATE INDEX idx_performance_reviews_subordinate_id ON performance_reviews(subordinate_id);
CREATE INDEX idx_performance_reviews_marked_as_deleted ON performance_reviews(marked_as_deleted);
CREATE UNIQUE INDEX uq_performance_reviews_subordinate_period_active
    ON performance_reviews(subordinate_id, period_id) WHERE marked_as_deleted = false;
