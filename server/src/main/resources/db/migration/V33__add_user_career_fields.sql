-- Career profile refs on users (v1.32.0): three nullable FKs into dictionary_entries (V31).
-- Stored as ENTRY IDS so dictionary renames propagate at read time; no ON DELETE clause —
-- entries are soft-deleted only, never physically removed (a soft-deleted referenced entry
-- keeps resolving to its retained value). ADD COLUMN precedent: V20/V21. No indexes: the
-- fields are never filtered or sorted on.
ALTER TABLE users ADD COLUMN career_path_id BIGINT NULL REFERENCES dictionary_entries(id);
ALTER TABLE users ADD COLUMN career_specialization_id BIGINT NULL REFERENCES dictionary_entries(id);
ALTER TABLE users ADD COLUMN seniority_level_id BIGINT NULL REFERENCES dictionary_entries(id);
