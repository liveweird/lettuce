ALTER TABLE teams
    ADD COLUMN marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_teams_marked_as_deleted ON teams(marked_as_deleted);
