CREATE TABLE teams (
    id         BIGSERIAL    PRIMARY KEY,
    name       VARCHAR(100) NOT NULL,
    manager_id BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX idx_teams_manager_id ON teams(manager_id);

CREATE TABLE team_members (
    team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (team_id, user_id)
);
CREATE INDEX idx_team_members_user_id ON team_members(user_id);
