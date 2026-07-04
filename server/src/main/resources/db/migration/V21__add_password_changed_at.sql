-- Epoch millis of the last password change; 0 = never changed since creation.
-- Used to invalidate outstanding refresh tokens on password change: /refresh rejects
-- tokens whose iat predates this value (access tokens die naturally within their TTL).
ALTER TABLE users ADD COLUMN password_changed_at BIGINT NOT NULL DEFAULT 0;
