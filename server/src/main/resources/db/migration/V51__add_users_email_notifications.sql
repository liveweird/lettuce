-- Per-user email-notification opt-out (v2.3.0). TRUE (the default) = every in-app
-- notification minted for the user is also mirrored to their inbox; FALSE = in-app only.
-- Self-service via PUT /api/v1/users/{id}/email-notifications (target user or ADMIN).
ALTER TABLE users ADD COLUMN email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
