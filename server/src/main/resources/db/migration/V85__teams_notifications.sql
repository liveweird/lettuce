-- Microsoft Teams direct messages, the third notification channel (v4.5.0).
--
-- 1. Widen the V84 channel CHECK to admit 'TEAMS'. The constraint name was verified against the
--    running compose database (`\d user_notification_preferences`) rather than assumed:
--    "user_notification_preferences_channel_check" (Postgres's auto-generated
--    <table>_<column>_check shape for an inline, unnamed CHECK). Drop and re-add it named, the
--    V37/V56 drop-CHECK/rewrite/re-add idiom — an explicit name survives the next such rename
--    without another round of "guess the auto-generated name".
ALTER TABLE user_notification_preferences DROP CONSTRAINT user_notification_preferences_channel_check;
ALTER TABLE user_notification_preferences
    ADD CONSTRAINT ck_user_notification_preferences_channel CHECK (channel IN ('IN_APP', 'EMAIL', 'TEAMS'));

-- 2. TEAMS_NOTIFICATIONS joins the per-user feature flags with an INVERTED default, the MFA
--    idiom (V52): every existing user (soft-deleted and deactivated rows included) starts with
--    the disabled row present — Teams DMs are opt-in, an admin must switch them on per user.
--    UserService.create inserts the same row for every user created after this migration.
INSERT INTO user_disabled_features (user_id, feature)
SELECT id, 'TEAMS_NOTIFICATIONS' FROM users
ON CONFLICT DO NOTHING;

-- 3. The Teams identity cache: Lettuce resolves a user's Entra object id from their Lettuce
--    email via Microsoft Graph (there is no sending by email/UPN), and the conversation id the
--    Bot Framework connector hands back for a created 1:1 conversation, then caches both so a
--    notification doesn't re-resolve/re-create on every send. It's a cache, not a record — hard
--    deleted and upserted, never soft-deleted (the days-off pool grant / preference-row class of
--    exception; see "Soft delete" in `.claude/docs/persistence.md`, which this migration adds it
--    to). A stored email that no longer matches the user's current (canonical) email invalidates
--    the row (checked application-side, not by a DB constraint — the row is simply re-resolved).
--    unreachable_reason/unreachable_until record why and until when a resolve/send attempt
--    should be skipped (an uninstalled bot, an unknown Graph user, a blocked conversation) so a
--    persistently unreachable recipient isn't hammered on every notification — the V81
--    login-lockout/MFA-challenge "record failure state in a row, read before pruning" shape.
--    Epoch-millisecond timestamps throughout, the users.password_changed_at/last_login_at
--    convention (BIGINT, not TIMESTAMPTZ).
CREATE TABLE user_teams_identities (
    user_id             BIGINT       NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email                VARCHAR(254) NOT NULL,
    aad_object_id        VARCHAR(64),
    conversation_id      VARCHAR(512),
    unreachable_reason   VARCHAR(32),
    unreachable_until    BIGINT,
    updated_at           BIGINT       NOT NULL
);
