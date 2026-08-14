-- Career position history (v2.15.0): the admin-managed users.career_*_id triple (V33) becomes
-- a manager-managed timeline of positions (position = the career triple, valid from start_date).
-- START-ONLY model: a position ends the day before the NEXT active position of the same user
-- starts (derived at read time, never stored); the latest one is open-ended — continuity and
-- non-overlap hold by construction. start_date is strict zero-padded ISO YYYY-MM-DD in a
-- VARCHAR, so lexicographic == chronological (the V34 review-periods idiom). Dictionary refs
-- copy V33: plain FKs, no ON DELETE (entries only soft-delete), resolved at read time so
-- renames propagate. Rows soft-delete per the house convention (the V42 corrections shape);
-- the partial unique index frees a deleted row's (user, start) pair and backstops concurrent
-- same-day inserts (23505 -> 409 via the central handler).
CREATE TABLE user_career_positions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    start_date VARCHAR(10) NOT NULL,
    career_path_id BIGINT NULL REFERENCES dictionary_entries(id),
    career_specialization_id BIGINT NULL REFERENCES dictionary_entries(id),
    seniority_level_id BIGINT NULL REFERENCES dictionary_entries(id),
    created_at BIGINT NOT NULL,
    last_modified BIGINT NOT NULL,
    marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_user_career_positions_user_id ON user_career_positions(user_id);
CREATE INDEX idx_user_career_positions_marked_as_deleted ON user_career_positions(marked_as_deleted);
CREATE UNIQUE INDEX uq_user_career_positions_user_start_active
    ON user_career_positions(user_id, start_date) WHERE marked_as_deleted = false;

-- The single current triple moves to the timeline WITHOUT a seed (deliberate: histories start
-- empty — there is no truthful start date to invent for the existing values, so managers enter
-- positions from scratch and the current triple everywhere derives from the latest position).
-- Dropping the columns drops their inline FK constraints with them; V33 added no indexes.
ALTER TABLE users DROP COLUMN career_path_id;
ALTER TABLE users DROP COLUMN career_specialization_id;
ALTER TABLE users DROP COLUMN seniority_level_id;
