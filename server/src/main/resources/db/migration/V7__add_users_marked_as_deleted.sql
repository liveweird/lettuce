ALTER TABLE users
    ADD COLUMN marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_users_marked_as_deleted ON users(marked_as_deleted);
