-- Append-only trail of team-structure actions (v4.18.0, the TEAM_MEMBERSHIP area of the per-user
-- activity log — see activity/ and .claude/docs/features/activity-log.md): the eleventh *_events
-- clone, keyed on the TEAM the action concerns. `team_id` = the team whose structure was touched;
-- `user_id` = the ACTOR (the ADMIN who created/renamed/deleted a team, changed its roster or edited
-- its dated membership / manager-period rows — team structure is ADMIN territory). The actor is
-- nullable like every events table since V80.
--
-- Written by the routes after each service commit and their audit line (the AUD-001 consistency
-- model), forward-only: nothing before this migration can be reconstructed (V93's period rows carry
-- no actor and the OTel audit stream is not a store). Params are content-free: ids, ISO dates and
-- NAME SNAPSHOTS of the team and the people involved, frozen at mint time (teams are renamed and
-- people renamed or deleted, so a log line must keep reading as it did). Rows are never updated or
-- deleted; teams and users are only ever soft-deleted, hence RESTRICT on both FKs.
CREATE TABLE team_structure_events (
    id         BIGSERIAL   PRIMARY KEY,
    team_id    BIGINT      NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    user_id    BIGINT      NULL     REFERENCES users(id) ON DELETE RESTRICT,
    created_at BIGINT      NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    params     TEXT        NOT NULL   -- JSON object of string params; "{}" when none
);

-- team_id: the RESTRICT FK check and a team-keyed read; (user_id, created_at): the actor's own log
-- like the other trails (V87/V88/V89).
CREATE INDEX idx_team_structure_events_team_id      ON team_structure_events(team_id);
CREATE INDEX idx_team_structure_events_user_created ON team_structure_events(user_id, created_at);
