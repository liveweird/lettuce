-- Global dictionaries (career paths, career specializations, seniority levels): one shared
-- table, discriminated by `dictionary` (the application enum's name is the whitelist — the
-- V27 user_roles precedent, no CHECK: the value is written exactly once at insert from the
-- Kotlin enum). Entries are admin-curated ordered short values, soft-deleted only. `value`
-- uniqueness is per dictionary over ACTIVE rows only (partial unique index — the V16/V18
-- pattern), so a deleted entry frees its value for a NEW row; soft-deleted rows keep their
-- stale `position` (reads filter active and order by position, id — dead positions are
-- never compared).
CREATE TABLE dictionary_entries (
    id                BIGSERIAL    PRIMARY KEY,
    dictionary        VARCHAR(30)  NOT NULL,
    position          INT          NOT NULL,
    value             VARCHAR(100) NOT NULL,
    marked_as_deleted BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_dictionary_entries_marked_as_deleted ON dictionary_entries(marked_as_deleted);

CREATE UNIQUE INDEX uq_dictionary_entries_value_active
    ON dictionary_entries(dictionary, value)
    WHERE marked_as_deleted = false;
