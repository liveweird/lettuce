-- Encrypt the four performance-review rating columns at rest (v1.49.0), completing the
-- feature's confidentiality story: the *_summary columns have been encrypted since V35, and
-- the DB-level-attacker threat model (see "Encryption at rest" in .claude/docs/security.md)
-- applies to the numeric assessments just as much. The original "plaintext on purpose: list
-- rows carry them and calculations run on them" rationale no longer holds — no SQL sorts,
-- filters, or aggregates on ratings anywhere (the reviews dashboard sorts and computes its
-- 1-6 distribution entirely client-side), so the columns become AES-256-GCM envelopes like
-- their summary siblings. The CHECK constraints cannot see through the envelope; the 1-6
-- range is enforced solely by validateAssessments (reviews/PerformanceReview.kt), which has
-- always been the authoritative gate.
--
-- The USING cast leaves pre-encryption rows as legacy plaintext digits, which
-- FieldCipher.decrypt passes through unchanged and the boot backfill
-- (PerformanceReviewService.encryptLegacyRows, run from configureBootstrap) wraps once,
-- idempotently — no manual steps for existing dev volumes. No production data exists.
ALTER TABLE performance_reviews DROP CONSTRAINT performance_reviews_attitude_rating_check;
ALTER TABLE performance_reviews DROP CONSTRAINT performance_reviews_delivery_rating_check;
ALTER TABLE performance_reviews DROP CONSTRAINT performance_reviews_skills_rating_check;
ALTER TABLE performance_reviews DROP CONSTRAINT performance_reviews_overall_rating_check;

ALTER TABLE performance_reviews ALTER COLUMN attitude_rating TYPE TEXT USING attitude_rating::text;
ALTER TABLE performance_reviews ALTER COLUMN delivery_rating TYPE TEXT USING delivery_rating::text;
ALTER TABLE performance_reviews ALTER COLUMN skills_rating TYPE TEXT USING skills_rating::text;
ALTER TABLE performance_reviews ALTER COLUMN overall_rating TYPE TEXT USING overall_rating::text;

-- RATING_CHANGED history events used to carry the plaintext from/to values in their params —
-- the one place ratings leaked outside the table. New events carry only the category (the
-- SUMMARY_CHANGED shape); this scrubs the values from any pre-existing rows (dev volumes
-- only — no production data). The params column is a flat JSON string map.
UPDATE performance_review_events
    SET params = (params::jsonb - 'from' - 'to')::text
    WHERE event_type = 'RATING_CHANGED';
