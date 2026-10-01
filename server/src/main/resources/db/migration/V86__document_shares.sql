-- Document sharing (v4.8.0): a person who can read a document IN THEIR OWN RIGHT may share it
-- read-only with another person, open-ended or until a date (see sharing/ and
-- .claude/docs/features/sharing.md). One POLYMORPHIC table for every shareable document type —
-- the enum NAME in `resource_type` (no CHECK, the V27/V46 idiom: the application enum is the
-- whitelist, a future type needs no migration) plus the document's id in `resource_id`.
--
-- No FK on `resource_id`: the column is polymorphic, and a soft-deleted document simply 404s
-- through its feature adapter (the mfa_challenges.user_id V81 precedent for a deliberately
-- unreferenced id).
--
-- No soft-delete column: `withdrawn_at` IS the terminal removal — the integration_clients
-- `revoked_at` (V71) precedent. A withdrawn share is never reopened (a re-share is a new row)
-- and rows are never physically deleted, so the table is its own audit trail. The paired CHECK
-- keeps the stamp and the actor together.
--
-- "At most one ACTIVE share per (document, sharer, sharee)" cannot be a unique index: whether a
-- share is active depends on today's date (`expires_on`), which is not an immutable predicate.
-- It is an in-transaction pre-check serialized per sharer by pg_advisory_xact_lock — see
-- ShareService.create. `expires_on` is a strict ISO date (VARCHAR(10), like feedbacks.expires_on),
-- inclusive: the share works through the end of that day.
--
-- `details` is a content-free SNAPSHOT of the document's labels (title/party facts, a JSON map
-- like notifications.params — never decrypted content), taken when the share is created and
-- served as-is ever after: a lapsed, expired or withdrawn share must not keep leaking the
-- document's CURRENT title or state to someone who no longer has access. NULL = no snapshot
-- (a row of a type this build cannot label).
CREATE TABLE document_shares (
    id            BIGSERIAL    PRIMARY KEY,
    resource_type VARCHAR(30)  NOT NULL,
    resource_id   BIGINT       NOT NULL,
    sharer_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    sharee_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    expires_on    VARCHAR(10)  NULL,
    created_at    BIGINT       NOT NULL,
    withdrawn_at  BIGINT       NULL,
    withdrawn_by  BIGINT       NULL REFERENCES users(id) ON DELETE RESTRICT,
    details       TEXT         NULL,
    CONSTRAINT chk_document_shares_distinct_parties CHECK (sharer_id <> sharee_id),
    CONSTRAINT chk_document_shares_withdrawn_pair CHECK ((withdrawn_at IS NULL) = (withdrawn_by IS NULL))
);

-- The read-time lookup (a sharee's active shares of one document) and the per-document list.
CREATE INDEX idx_document_shares_document ON document_shares(resource_type, resource_id, sharee_id);
CREATE INDEX idx_document_shares_sharee ON document_shares(sharee_id);
CREATE INDEX idx_document_shares_sharer ON document_shares(sharer_id);
