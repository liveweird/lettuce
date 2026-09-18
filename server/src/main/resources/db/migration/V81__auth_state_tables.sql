-- DB-backed auth state (v3.11.0): the per-account login lockout, the self-service
-- password-reset throttle, and the email-MFA challenge store were in-memory and
-- per-instance since v2.4.0 (LoginThrottle/PasswordResetThrottle/MfaChallenges, all
-- ConcurrentHashMap-backed) — fine for a single replica, but it meant a restart silently
-- reset every counter and a future multi-replica deployment would split the state across
-- pods. Moving them into Postgres makes replicas share the state and a restart no longer
-- reset anything. There is no background sweeper: every store prunes its own stale rows
-- on the write path (issue/recordFailure/tryAcquire), so an abandoned key just accumulates
-- until the next write touches it — bounded in practice by the per-IP RateLimit buckets in
-- front of every write path (login/password-reset/mfa).

CREATE TABLE login_lockouts (
    email        VARCHAR(254) PRIMARY KEY,
    failures     INTEGER      NOT NULL DEFAULT 0,
    locked_until BIGINT       NOT NULL DEFAULT 0,
    last_touched BIGINT       NOT NULL
);
CREATE INDEX idx_login_lockouts_last_touched ON login_lockouts (last_touched);

CREATE TABLE password_reset_requests (
    email           VARCHAR(254) PRIMARY KEY,
    last_request_at BIGINT       NOT NULL
);
CREATE INDEX idx_password_reset_requests_last_request_at ON password_reset_requests (last_request_at);

-- No FK on user_id: a challenge is a transient artifact (single-use, TTL-bounded — see
-- MfaChallenges.kt) rather than a durable record referencing a user, and the store's own
-- unit tests issue challenges for arbitrary ids that need not exist in `users`.
CREATE TABLE mfa_challenges (
    id         VARCHAR(32) PRIMARY KEY,
    user_id    BIGINT      NOT NULL,
    code_hash  VARCHAR(64) NOT NULL,
    expires_at BIGINT      NOT NULL,
    attempts   INTEGER     NOT NULL DEFAULT 0
);
CREATE INDEX idx_mfa_challenges_expires_at ON mfa_challenges (expires_at);
