-- Immutable audit trail of performance-review changes, mirroring goal_events (V26). Rows are
-- minted as a side-effect of review create/update/transition/delete (no public create endpoint);
-- there is no update or delete. Events are stored structurally (event_type + a JSON params map)
-- so the SPA can render each one in the viewer's language. Params carry category/enum names and
-- numeric rating values only — NEVER summary text (the summaries are encrypted at rest and must
-- not leak here in plaintext). The CASCADE never fires under soft delete — events outlive a
-- soft-deleted review.
CREATE TABLE performance_review_events (
    id         BIGSERIAL   PRIMARY KEY,
    review_id  BIGINT      NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at BIGINT      NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    params     TEXT        NOT NULL   -- JSON object of string params, e.g. {"from":"DRAFT"}; "{}" when none
);

CREATE INDEX idx_performance_review_events_review_id ON performance_review_events(review_id);
