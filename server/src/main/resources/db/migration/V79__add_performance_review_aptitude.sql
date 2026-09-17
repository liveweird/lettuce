-- Add the fifth performance-review assessment: aptitude (v3.10.0), assessed like
-- attitude/delivery/skills/overall with an encrypted 1–6 rating and an encrypted text summary.
-- Both columns are AES-256-GCM envelopes (enc:v1:...) like their siblings since V45; the 1–6
-- range is enforced by validateAssessments (reviews/PerformanceReview.kt), so no CHECK — and no
-- index, ciphertext is never queried/sorted/filtered in SQL. See "Encryption at rest" in
-- .claude/docs/security.md.
ALTER TABLE performance_reviews
    ADD COLUMN aptitude_rating  TEXT NULL,
    ADD COLUMN aptitude_summary TEXT NULL;
