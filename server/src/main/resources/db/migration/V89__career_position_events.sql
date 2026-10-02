-- Append-only trail of career-position actions (v4.9.0, step 5 of the per-user activity log — see
-- activity/ and .claude/docs/features/activity-log.md): the ninth *_events clone, person-keyed like
-- days_off_events (V88). `owner_id` = the person whose career timeline was touched; `user_id` = the
-- ACTOR (the chain manager who recorded/corrected/deleted a position — never the person themselves
-- or ADMIN, the write right is the transitive chain's alone). The actor is nullable like every
-- events table since V80.
--
-- Written by the routes after each service commit (the AUD-001 consistency model), forward-only:
-- nothing before this migration can be reconstructed (user_career_positions has no actor column and
-- the OTel audit stream is not a store). Params are content-free: dates, dictionary entry ids and
-- the entries' display names FROZEN at mint time (dictionary entries are soft-deleted and
-- renamable, so a log line must keep reading as it did). Account deactivation's closeFinalPosition/
-- reopen mint nothing — an ADMIN account action, not a manager's career write. Rows are never
-- updated or deleted; users are only ever soft-deleted, hence RESTRICT on both FKs.
CREATE TABLE career_position_events (
    id         BIGSERIAL   PRIMARY KEY,
    owner_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    user_id    BIGINT      NULL     REFERENCES users(id) ON DELETE RESTRICT,
    created_at BIGINT      NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    params     TEXT        NOT NULL   -- JSON object of string params; "{}" when none
);

-- owner_id: the activity log's chain-visibility filter (`owner_id = viewer OR owner_id = ANY(chain)`)
-- and the RESTRICT FK check; (user_id, created_at): the actor's own log like the other trails (V87/V88).
CREATE INDEX idx_career_position_events_owner_id     ON career_position_events(owner_id);
CREATE INDEX idx_career_position_events_user_created ON career_position_events(user_id, created_at);
