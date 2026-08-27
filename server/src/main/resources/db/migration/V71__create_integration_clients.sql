-- Integration clients (v3.0.0): the dedicated technical identities behind the read-only
-- integration GraphQL API (POST /integration/graphql). Deliberately NOT rows in `users` —
-- a user row leaks into people lists, party pickers, the pyramid, and deactivation checks;
-- a client is a machine, not a person. Each client holds ONE API key, generated server-side
-- and shown exactly once at creation (the CSV-import password precedent); only its SHA-256
-- hex digest is stored (high-entropy random keys need no bcrypt work factor). Admin-managed
-- via /api/v1/integration-clients. No soft-delete column: `revoked_at` IS the removal — the
-- terminal disable (the days-off "status is the user-facing removal" precedent; keys are
-- immutable, so there is no UPDATE or DELETE endpoint, only POST {id}/revoke). Revoked rows
-- stay listed for the audit trail.
CREATE TABLE integration_clients (
    id           BIGSERIAL    PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    key_hash     VARCHAR(64)  NOT NULL,          -- SHA-256 hex of the full API key
    created_by   BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at   BIGINT       NOT NULL,
    last_used_at BIGINT       NULL,               -- stamped on every authenticated request
    revoked_at   BIGINT       NULL                -- non-null = terminally disabled
);

CREATE UNIQUE INDEX uq_integration_clients_key_hash ON integration_clients(key_hash);
