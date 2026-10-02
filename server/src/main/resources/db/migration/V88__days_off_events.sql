-- Append-only trail of days-off actions (v4.9.0, step 4 of the per-user activity log — see
-- activity/ and .claude/docs/features/activity-log.md): the eighth *_events clone, but keyed on
-- the PERSON the action concerns rather than on a document — days-off entries and budgets have no
-- per-record view, and a manager acting on a report's leave is exactly what the log must show.
-- `owner_id` = the person whose leave or budget was touched; `user_id` = the ACTOR (the owner for a
-- self-service entry, a chain manager for a recording on someone's behalf, a correction or an
-- allowance change). Both reference users; the actor is nullable like every events table since
-- V80 (system-originated events).
--
-- Written by the routes after each service commit (the AUD-001 consistency model), forward-only:
-- nothing before this migration can be reconstructed — days-off requests lost every actor stamp
-- in V77 and the OTel audit stream is not a store. Params are content-free (ids, dates, enum
-- names, numbers, the pool kind's name frozen at mint time) — NEVER the encrypted correction
-- comment or cancellation reason. Rows are never updated or deleted (events outlive the soft-deleted
-- entry/correction they describe), and users are only ever soft-deleted — hence RESTRICT on both
-- FKs: a physical user delete must never silently take a person's trail with it.
CREATE TABLE days_off_events (
    id         BIGSERIAL   PRIMARY KEY,
    owner_id   BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    user_id    BIGINT      NULL     REFERENCES users(id) ON DELETE RESTRICT,
    created_at BIGINT      NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    params     TEXT        NOT NULL   -- JSON object of string params; "{}" when none
);

-- The activity log's chain-visibility filter (`owner_id = viewer OR owner_id = ANY(chain)`) reads
-- owner_id; the actor's own log reads (user_id, created_at) like the seven document trails (V87).
CREATE INDEX idx_days_off_events_owner_id     ON days_off_events(owner_id);
CREATE INDEX idx_days_off_events_user_created ON days_off_events(user_id, created_at);
