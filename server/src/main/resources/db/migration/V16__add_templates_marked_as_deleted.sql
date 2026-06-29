ALTER TABLE templates
    ADD COLUMN marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_templates_marked_as_deleted ON templates(marked_as_deleted);

-- Free the names of soft-deleted templates: replace the global UNIQUE(name)
-- with a partial unique index that only constrains active (non-deleted) rows.
ALTER TABLE templates DROP CONSTRAINT templates_name_key;

CREATE UNIQUE INDEX uq_templates_name_active
    ON templates(name)
    WHERE marked_as_deleted = false;
