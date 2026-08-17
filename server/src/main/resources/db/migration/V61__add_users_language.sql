-- Per-user language (v2.21.0): drives the UI at sign-in and the language of every
-- server-composed email (recipient-specific since this release — previously bilingual
-- EN+PL in one body). ADMIN sets it at create (default English); self or ADMIN may change
-- it via PUT /api/v1/users/{id}/language. No CHECK — the application constant
-- SUPPORTED_LANGUAGES (dictionaries/Languages.kt) is the whitelist (the V27 idiom).
ALTER TABLE users ADD COLUMN language VARCHAR(10) NOT NULL DEFAULT 'en';
