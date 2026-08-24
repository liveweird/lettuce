-- Impact log (v2.36.0): a per-employee journal of accomplishments — the Self-reflection
-- feature's replacement. Each entry covers a period (a pair of ISO dates in lexicographically
-- ordered VARCHAR(10) columns, start <= end) and four markdown sections, ALL encrypted at rest
-- by the application (enc:v1:… envelopes, never filtered/sorted in SQL — see
-- infra/crypto/FieldCipher.kt). The owner (user_id) is the only writer; managers in the owner's
-- transitive chain and HR read. Rows soft-delete per the house convention.
CREATE TABLE impact_log_entries (
    id                BIGSERIAL   PRIMARY KEY,
    user_id           BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    period_start      VARCHAR(10) NOT NULL,  -- ISO YYYY-MM-DD (lexicographic == chronological)
    period_end        VARCHAR(10) NOT NULL,  -- ISO YYYY-MM-DD, >= period_start
    what_happened     TEXT        NOT NULL,  -- encrypted at rest
    contribution      TEXT        NOT NULL,  -- encrypted at rest
    why_it_mattered   TEXT        NOT NULL,  -- encrypted at rest
    evidence          TEXT        NOT NULL,  -- encrypted at rest
    created_at        BIGINT      NOT NULL,  -- epoch millis, immutable
    last_modified     BIGINT      NOT NULL,
    marked_as_deleted BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_impact_log_entries_user_id ON impact_log_entries(user_id);
CREATE INDEX idx_impact_log_entries_period_start ON impact_log_entries(period_start);
CREATE INDEX idx_impact_log_entries_marked_as_deleted ON impact_log_entries(marked_as_deleted);

-- Immutable audit trail of entry changes, mirroring goal_events (V26). Rows are minted as a
-- side-effect of entry create/update/delete (no public create endpoint); there is no update or
-- delete — events outlive a soft-deleted entry (the CASCADE never fires). Events are stored
-- structurally (event_type + a JSON params map) so the SPA can render each one in the viewer's
-- language. Params carry ISO dates and field-name lists only — NEVER section text (the four
-- sections are encrypted at rest and must not leak here in plaintext).
CREATE TABLE impact_log_events (
    id         BIGSERIAL   PRIMARY KEY,
    entry_id   BIGINT      NOT NULL REFERENCES impact_log_entries(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at BIGINT      NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    params     TEXT        NOT NULL   -- JSON object of string params, e.g. {"changed":"periodStart"}; "{}" when none
);

CREATE INDEX idx_impact_log_events_entry_id ON impact_log_events(entry_id);
