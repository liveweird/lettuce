-- Immutable audit trail of goal changes, mirroring feedback_events (V15) and
-- one_on_one_events (V24). Rows are minted as a side-effect of goal create/update/transition/
-- delete (no public create endpoint); there is no update or delete. Events are stored
-- structurally (event_type + a JSON params map) so the SPA can render each one in the viewer's
-- language. Params carry enum names and numeric values only — NEVER title/description/summary
-- text (description and summary are encrypted at rest and must not leak here in plaintext).
CREATE TABLE goal_events (
    id         BIGSERIAL   PRIMARY KEY,
    goal_id    BIGINT      NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at BIGINT      NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    params     TEXT        NOT NULL   -- JSON object of string params, e.g. {"from":"DRAFT"}; "{}" when none
);

CREATE INDEX idx_goal_events_goal_id ON goal_events(goal_id);
