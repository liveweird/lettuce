CREATE TABLE notifications (
    id           BIGSERIAL PRIMARY KEY,
    recipient_id BIGINT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at   BIGINT    NOT NULL,
    message      TEXT      NOT NULL,
    link         TEXT,
    was_seen     BOOLEAN   NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_notifications_recipient_id ON notifications(recipient_id);
