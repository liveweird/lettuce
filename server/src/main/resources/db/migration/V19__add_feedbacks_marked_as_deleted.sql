ALTER TABLE feedbacks
    ADD COLUMN marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_feedbacks_marked_as_deleted ON feedbacks(marked_as_deleted);
