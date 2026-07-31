-- Additional roles per user (every user is implicitly USER — never stored).
-- No CHECK on role: the application enum is the whitelist, so a future role
-- needs no migration.
CREATE TABLE user_roles (
    user_id BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role    VARCHAR(30) NOT NULL,
    PRIMARY KEY (user_id, role)
);
CREATE INDEX idx_user_roles_role ON user_roles(role);

INSERT INTO user_roles (user_id, role)
SELECT id, 'ADMIN' FROM users WHERE role = 'ADMIN';

-- Drops idx_users_role and the V5 CHECK with it.
ALTER TABLE users DROP COLUMN role;
