-- Impact-log entry title (v2.37.0): a short single-line identity for the entry, shown on the
-- journal lists (instead of the decrypted what-happened preview) and in the view/edit headers.
-- PLAINTEXT by design — lists sort and substring-filter on it (the goals.title rationale);
-- the four sections stay encrypted. '' only on pre-V66 rows: validation requires a non-blank
-- title on every create/update, so a legacy row picks one up at its next edit.
ALTER TABLE impact_log_entries ADD COLUMN title VARCHAR(200) NOT NULL DEFAULT '';
