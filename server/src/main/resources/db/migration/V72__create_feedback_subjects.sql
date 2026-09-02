-- Multi-recipient feedback (v3.1.0): a feedback may be about up to FOUR people. The recipient
-- set lives in this join table (position-ordered, fixed at creation — no update path);
-- feedbacks.subject_id STAYS NOT NULL and is, by construction, the position-0 row: it remains
-- the sort/name anchor (sort=subjectName, the legacy subjectId/subjectName/subjectDeleted
-- fields) while membership questions (who may read, whose inbox, whose manager, the
-- per-recipient no-duplicate rule) go through this table. Hard-delete class like
-- succession_nomination_goals; the CASCADE never fires (feedbacks soft-delete).
CREATE TABLE feedback_subjects (
    feedback_id BIGINT NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    position    INT    NOT NULL CHECK (position BETWEEN 0 AND 3),
    PRIMARY KEY (feedback_id, user_id),
    UNIQUE (feedback_id, position)
);
CREATE INDEX idx_feedback_subjects_user_id ON feedback_subjects(user_id);

-- Backfill: every existing feedback has exactly its single subject at position 0.
INSERT INTO feedback_subjects (feedback_id, user_id, position)
SELECT id, subject_id, 0 FROM feedbacks;
