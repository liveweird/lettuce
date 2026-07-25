-- Goals: a manager sets a tracked goal for a direct report. Status machine
-- DRAFT <-> ACTIVE <-> CLOSED (both directions, never skipping ACTIVE); every change is
-- recorded in goal_events (V26). The goal row is the soft-delete unit (DRAFT-only via the API).
-- Value fields are type-specific: target_value/current_value for NUMBER and PERCENTAGE
-- (0-100 for PERCENTAGE), achieved for BINARY; the non-applicable fields stay NULL.
CREATE TABLE goals (
    id                BIGSERIAL        PRIMARY KEY,
    manager_id        BIGINT           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    subordinate_id    BIGINT           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at        BIGINT           NOT NULL,  -- epoch millis, immutable
    title             VARCHAR(200)     NOT NULL,  -- plaintext: lists sort/filter on it
    description       TEXT             NOT NULL,  -- encrypted at rest (enc:v1:…), never filtered/sorted in SQL
    type              VARCHAR(20)      NOT NULL CHECK (type IN ('BINARY', 'NUMBER', 'PERCENTAGE')),
    target_value      DOUBLE PRECISION NULL,      -- NUMBER/PERCENTAGE only
    current_value     DOUBLE PRECISION NULL,      -- NUMBER/PERCENTAGE only
    achieved          BOOLEAN          NULL,      -- BINARY only
    status            VARCHAR(20)      NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
    summary           TEXT             NULL,      -- encrypted at rest; set by the close action only
    last_modified     BIGINT           NOT NULL,
    marked_as_deleted BOOLEAN          NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_goals_manager_id ON goals(manager_id);
CREATE INDEX idx_goals_subordinate_id ON goals(subordinate_id);
CREATE INDEX idx_goals_marked_as_deleted ON goals(marked_as_deleted);
