-- Epoch millis of the last successful login completion; 0 = never logged in (the
-- password_changed_at idiom, V21). Stamped only when a login actually completes — the
-- non-MFA /login success and the /login/mfa code-exchange success — never /refresh, and
-- never the password step of an MFA login (see auth/AuthRoutes.kt).
ALTER TABLE users ADD COLUMN last_login_at BIGINT NOT NULL DEFAULT 0;
