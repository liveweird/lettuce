-- In-app notifications, minted as a side-effect of feedback activity (no create endpoint).
-- Stored structurally (notification_type + a JSON params map of party names) so the SPA renders
-- each one in the viewer's language; the optional link is a language-independent SPA path.
CREATE TABLE notifications (
    id                BIGSERIAL   PRIMARY KEY,
    recipient_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at        BIGINT      NOT NULL,
    notification_type VARCHAR(60) NOT NULL,
    params            TEXT        NOT NULL,   -- JSON object of string params (party names); "{}" when none
    link              TEXT,
    was_seen          BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_notifications_recipient_id ON notifications(recipient_id);
