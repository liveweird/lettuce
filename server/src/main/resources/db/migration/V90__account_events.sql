-- Account (sign-in) trail of the per-user activity log (v4.9.0, step 6 — see activity/ and
-- .claude/docs/features/activity-log.md): completed sign-ins (`SIGNED_IN {mfa}`) and explicit
-- sign-outs (`SIGNED_OUT`) — nothing else: no failures, lockouts, refreshes, password events, no IP,
-- no user agent. The tenth *_events clone; it keeps the EventLogTable shape (`owner_id`, `user_id`,
-- `created_at`, `event_type`, `params`) although the owner IS the actor here (the account itself
-- signs in/out) — `owner_id` and `user_id` always carry the same id, which is why there is NO
-- separate owner index: the log reads the actor's rows through (user_id, created_at) like the other
-- trails, and the chain-visibility predicate (`owner_id = ANY(chain)`) only ever filters rows that
-- index already narrowed to one target. Both FKs RESTRICT (users are only soft-deleted).
--
-- Written by the auth routes AFTER the login/logout succeeded (a failing write is logged and never
-- fails the request) and forward-only: before this migration sign-ins exist only as
-- users.last_login_at (V78) and OTel audit lines.
--
-- RETENTION — the registered hard-delete exception (the notifications precedent, V82): unlike every
-- other events table this one is PURGED. Sign-in rows older than `activity.accountRetentionDays`
-- (default 90, 0 = keep forever) are deleted on the write path, throttled by
-- `activity.accountPurgeIntervalSeconds` — a high-volume, low-value, personal-data-adjacent log must
-- not grow without bound. idx_account_events_created_at serves that purge DELETE.
CREATE TABLE account_events (
    id         BIGSERIAL   PRIMARY KEY,
    owner_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    user_id    BIGINT      NULL     REFERENCES users(id) ON DELETE RESTRICT,
    created_at BIGINT      NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    params     TEXT        NOT NULL   -- JSON object of string params, e.g. {"mfa":"true"}; "{}" when none
);

CREATE INDEX idx_account_events_user_created ON account_events(user_id, created_at);
CREATE INDEX idx_account_events_created_at   ON account_events(created_at);
