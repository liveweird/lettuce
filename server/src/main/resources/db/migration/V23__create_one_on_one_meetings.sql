-- 1:1 meetings: a manager documents the outcomes of a recurring meeting with a direct report.
-- No status machine — meetings stay editable forever; every change is recorded in
-- one_on_one_events (V24). The meeting row is the soft-delete unit; its detail rows
-- (one_on_one_notes, one_on_one_action_items) hard-delete on full-document replace,
-- per the convention that join/detail tables hard-delete.
CREATE TABLE one_on_one_meetings (
    id                BIGSERIAL   PRIMARY KEY,
    manager_id        BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    subordinate_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    meeting_date      VARCHAR(10) NOT NULL,  -- ISO YYYY-MM-DD (lexicographic == chronological)
    last_modified     BIGINT      NOT NULL,
    marked_as_deleted BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_one_on_one_meetings_manager_id ON one_on_one_meetings(manager_id);
CREATE INDEX idx_one_on_one_meetings_subordinate_id ON one_on_one_meetings(subordinate_id);
CREATE INDEX idx_one_on_one_meetings_marked_as_deleted ON one_on_one_meetings(marked_as_deleted);

-- Points discussed + decisions made: ordered plain paragraphs, discriminated by kind.
CREATE TABLE one_on_one_notes (
    id         BIGSERIAL   PRIMARY KEY,
    meeting_id BIGINT      NOT NULL REFERENCES one_on_one_meetings(id) ON DELETE CASCADE,
    kind       VARCHAR(10) NOT NULL CHECK (kind IN ('POINT', 'DECISION')),
    position   INT         NOT NULL,
    content    TEXT        NOT NULL   -- encrypted at rest (enc:v1:…), never filtered/sorted in SQL
);

CREATE INDEX idx_one_on_one_notes_meeting_id ON one_on_one_notes(meeting_id);

-- Action items: ordered paragraphs with an owner, optional due date, and a resolved flag.
-- Unresolved items are copied into the pair's next meeting at creation; copied_from_id links a
-- copy to its source so an item's history (all meetings it appeared in) can be reconstructed.
-- ON DELETE SET NULL: full-document replace hard-deletes rows, which must truncate (never block)
-- the chains of copies pointing at them.
CREATE TABLE one_on_one_action_items (
    id             BIGSERIAL   PRIMARY KEY,
    meeting_id     BIGINT      NOT NULL REFERENCES one_on_one_meetings(id) ON DELETE CASCADE,
    position       INT         NOT NULL,
    content        TEXT        NOT NULL,  -- encrypted at rest, never filtered/sorted in SQL
    owner          VARCHAR(20) NOT NULL CHECK (owner IN ('MANAGER', 'SUBORDINATE')),
    due_date       VARCHAR(10) NULL,      -- ISO YYYY-MM-DD, NULL = no due date
    resolved       BOOLEAN     NOT NULL DEFAULT FALSE,
    copied_from_id BIGINT      NULL REFERENCES one_on_one_action_items(id) ON DELETE SET NULL
);

CREATE INDEX idx_one_on_one_action_items_meeting_id ON one_on_one_action_items(meeting_id);
CREATE INDEX idx_one_on_one_action_items_copied_from_id ON one_on_one_action_items(copied_from_id);
