-- Checkup #31 (v3.1.1): the membership subquery behind every feedback read scope is
-- `SELECT feedback_id FROM feedback_subjects WHERE user_id IN (…)` — the Received inbox, the
-- team scope, the subjectId/subjectName filters, the duplicate rule, and the dashboard's
-- received count all run it. A (user_id, feedback_id) index answers it index-only; the
-- single-column V72 index forced a heap fetch per match.
DROP INDEX idx_feedback_subjects_user_id;
CREATE INDEX idx_feedback_subjects_user_id_feedback_id ON feedback_subjects(user_id, feedback_id);
