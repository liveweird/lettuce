-- Immutable audit trail of feedback changes. Rows are minted as a side-effect of feedback
-- create/transition/edit (no public create endpoint); there is no update or delete.
-- Events are stored structurally (event_type + a JSON params map of enum names) so the SPA can
-- render each one in the viewer's language.
CREATE TABLE feedback_events (
    id          BIGSERIAL   PRIMARY KEY,
    feedback_id BIGINT      NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at  BIGINT      NOT NULL,
    event_type  VARCHAR(40) NOT NULL,
    params      TEXT        NOT NULL   -- JSON object of string params, e.g. {"from":"DRAFT","to":"SENT"}; "{}" when none
);

CREATE INDEX idx_feedback_events_feedback_id ON feedback_events(feedback_id);
