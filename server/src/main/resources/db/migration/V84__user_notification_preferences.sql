-- Per-user notification preferences (v4.0.0): the DISABLED (type, channel) pairs — the
-- user_disabled_features shape (V46): no row means everything is on, so the empty table needs
-- no seed and no backfill, and every existing/new user starts fully opted in on both channels.
-- notification_type stores the NotificationType enum's NAME with deliberately NO CHECK (the
-- V27 idiom AND the open-set rule, v3.25.3 — a future release that removes or renames a type
-- owes these rows the same same-commit migration its notifications rows get, see "Removing or
-- renaming a notification type" in `.claude/docs/features/notifications.md`). channel DOES carry
-- a CHECK: unlike the business enums, IN_APP/EMAIL is a fixed pair this migration itself
-- defines, not a whitelist that grows elsewhere. A join table wholesale-replaced by its owning
-- PUT hard-deletes like user_disabled_features — see "Soft delete" in
-- `.claude/docs/persistence.md`.
CREATE TABLE user_notification_preferences (
    user_id           BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(64) NOT NULL,
    channel           VARCHAR(10) NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL')),
    PRIMARY KEY (user_id, notification_type, channel)
);
