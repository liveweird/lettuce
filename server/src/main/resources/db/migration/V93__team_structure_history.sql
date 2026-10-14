-- Team structure history (v4.17.0): team membership and team management become DATED.
--
-- Until now `team_members(team_id, user_id)` (V2) was a flat current set and `teams.manager_id` the
-- current manager, so nothing recorded when someone joined or left a team or who managed it before.
-- Two history tables replace them:
--   team_memberships      one row per membership PERIOD of a person in a team. A person may hold
--                         several periods in different teams at once; periods of the SAME (team,
--                         person) never overlap (a rejoin is a new row) — enforced by the service
--                         under a per-team advisory lock, with the UNIQUE index as the same-start
--                         backstop.
--   team_manager_periods  the team's manager SUCCESSION LINE (the career-timeline idea): a live team
--                         has exactly one manager on every day, with no gaps and no overlaps — kept
--                         contiguous by the service (each end is the next start minus one day).
-- Dates are strict zero-padded ISO `YYYY-MM-DD` in a VARCHAR(10) (the V34/V57 house idiom, so
-- lexicographic == chronological and no new Exposed dependency). A NULL start means "since before
-- records began"; a NULL end means open-ended; otherwise the end is the INCLUSIVE last day. Time of
-- day is never recorded. UNIQUE ... NULLS NOT DISTINCT so two NULL-start rows of one team/person
-- (which would overlap) cannot coexist either.
--
-- CONVERSION: every existing membership (soft-deleted teams included) and every team's current
-- manager becomes one open/open row — start NULL, end NULL ("the beginning of time, no end"). Pre-V93
-- soft-deleted teams have no deletion date, so they stay open-ended residue; the history readers
-- (added with the history endpoints) hide a NULL-end period of a soft-deleted team.
--
-- TODAY'S READS STAY CORRECT BY CONSTRUCTION: `team_members` becomes a VIEW with its old shape
-- (team_id, user_id) holding only the CURRENT memberships, and `teams_current` a view of
-- (id, name, marked_as_deleted, manager_id) that resolves each team's manager as of today (the
-- period with the greatest start <= today; for a deleted team its last manager). Every existing
-- reader (the management chain, pulse scopes, team KPIs, ...) keeps reading these names unchanged;
-- writes go to the base tables. The views compare against CURRENT_DATE, i.e. the SESSION time zone —
-- infra/db/Database.kt aligns it with the JVM's (the app computes "today" with LocalDate.now()).
-- A live team with no manager period covering today would drop out of `teams_current` (INNER JOIN);
-- the service keeps the line covering today.
--
-- Period rows are HARD-deleted when they are removed (the join / team_kpi_values class); the audit
-- events are the trail. Both FKs RESTRICT: users and teams only soft-delete.

CREATE TABLE team_memberships (
    id            BIGSERIAL   PRIMARY KEY,
    team_id       BIGINT      NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    start_date    VARCHAR(10) NULL,
    end_date      VARCHAR(10) NULL,
    created_at    BIGINT      NOT NULL,
    last_modified BIGINT      NOT NULL,
    CONSTRAINT ck_team_memberships_range CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
CREATE INDEX idx_team_memberships_team ON team_memberships(team_id);
CREATE INDEX idx_team_memberships_user ON team_memberships(user_id);
CREATE UNIQUE INDEX uq_team_memberships_team_user_start
    ON team_memberships(team_id, user_id, start_date) NULLS NOT DISTINCT;

CREATE TABLE team_manager_periods (
    id            BIGSERIAL   PRIMARY KEY,
    team_id       BIGINT      NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    manager_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    start_date    VARCHAR(10) NULL,
    end_date      VARCHAR(10) NULL,
    created_at    BIGINT      NOT NULL,
    last_modified BIGINT      NOT NULL,
    CONSTRAINT ck_team_manager_periods_range CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
-- "the period with the greatest start" (teams_current) and the line's newest-first reads.
CREATE INDEX idx_team_manager_periods_team_start ON team_manager_periods(team_id, start_date DESC NULLS LAST);
CREATE INDEX idx_team_manager_periods_manager ON team_manager_periods(manager_id);
CREATE UNIQUE INDEX uq_team_manager_periods_team_start
    ON team_manager_periods(team_id, start_date) NULLS NOT DISTINCT;

-- Conversion: one open/open row per existing membership and per team's current manager.
INSERT INTO team_memberships (team_id, user_id, start_date, end_date, created_at, last_modified)
SELECT tm.team_id, tm.user_id, NULL, NULL,
       (extract(epoch FROM now()) * 1000)::bigint, (extract(epoch FROM now()) * 1000)::bigint
FROM team_members tm
ORDER BY tm.team_id, tm.user_id;

INSERT INTO team_manager_periods (team_id, manager_id, start_date, end_date, created_at, last_modified)
SELECT t.id, t.manager_id, NULL, NULL,
       (extract(epoch FROM now()) * 1000)::bigint, (extract(epoch FROM now()) * 1000)::bigint
FROM teams t
ORDER BY t.id;

-- The old flat table goes (its index with it); the view takes its name and shape.
DROP TABLE team_members;

-- The join to teams is semantically a no-op (the FK guarantees the row) and exists on purpose: a
-- single-table view would be AUTO-UPDATABLE, so a stray DELETE/UPDATE through `team_members` would
-- silently rewrite `team_memberships`. A join view is not auto-updatable ("cannot delete from view"),
-- and unlike DISTINCT/OFFSET it stays flattenable for the planner.
CREATE VIEW team_members (team_id, user_id) AS
SELECT m.team_id, m.user_id
FROM team_memberships m
JOIN teams t ON t.id = m.team_id
WHERE (m.start_date IS NULL OR m.start_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD'))
  AND (m.end_date IS NULL OR m.end_date >= to_char(CURRENT_DATE, 'YYYY-MM-DD'));

-- teams.manager_id (and idx_teams_manager_id with it) is replaced by the succession line.
ALTER TABLE teams DROP COLUMN manager_id;

-- A NULL start counts as "<= today" and sorts last under DESC, so the latest qualifying start wins.
CREATE VIEW teams_current (id, name, marked_as_deleted, manager_id) AS
SELECT t.id, t.name, t.marked_as_deleted, mp.manager_id
FROM teams t
JOIN LATERAL (
    SELECT p.manager_id
    FROM team_manager_periods p
    WHERE p.team_id = t.id
      AND (p.start_date IS NULL OR p.start_date <= to_char(CURRENT_DATE, 'YYYY-MM-DD'))
    ORDER BY p.start_date DESC NULLS LAST
    LIMIT 1
) mp ON TRUE;
