-- Immutable audit trail of feedback changes. Rows are minted as a side-effect of feedback
-- create/transition/edit (no public create endpoint); there is no update or delete.
CREATE TABLE feedback_events (
    id          BIGSERIAL PRIMARY KEY,
    feedback_id BIGINT    NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
    user_id     BIGINT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at  BIGINT    NOT NULL,
    content     TEXT      NOT NULL
);

CREATE INDEX idx_feedback_events_feedback_id ON feedback_events(feedback_id);
