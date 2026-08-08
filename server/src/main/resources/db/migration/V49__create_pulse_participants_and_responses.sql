-- Pulse participation snapshot + responses (v2.0.0).
--
-- pulse_participants freezes WHO was eligible at the moment a cycle was OPENED (active, not
-- deactivated, PULSE_SURVEYS feature enabled) — response rates and manager participation
-- monitoring read this snapshot, so later user churn never distorts a cycle's history.
-- Hard-delete convention like team_members, though rows are in practice never removed.
CREATE TABLE pulse_participants (
    cycle_id BIGINT NOT NULL REFERENCES pulse_cycles(id),
    user_id  BIGINT NOT NULL REFERENCES users(id),
    PRIMARY KEY (cycle_id, user_id)
);
CREATE INDEX idx_pulse_participants_user_id ON pulse_participants(user_id);

-- pulse_responses: one row per (cycle, participant), upserted while the cycle is OPEN.
-- user_id is AUDIT LINKAGE ONLY — no API ever returns a (user -> answers) pair; results are
-- served as team-scope aggregates and author-free comment lists. The six scored answers and
-- the comment are ENCRYPTED at rest (enc:v1: envelopes; values stored as strings "0".."10" /
-- "1".."5" / "NA" — the V45 review-ratings precedent). NEVER filter/sort/aggregate these
-- columns in SQL: aggregation loads a scope's rows and computes in the application. The
-- fixed Q1-Q5 wordings are not stored (client-side i18n); only the admin-editable rotating
-- question is snapshotted, on the cycle row. No soft-delete: responses are never deletable —
-- they are retained for audit even when the cycle is cancelled (a detail-table exception to
-- the convention, like team_kpi_values).
CREATE TABLE pulse_responses (
    id            BIGSERIAL PRIMARY KEY,
    cycle_id      BIGINT    NOT NULL REFERENCES pulse_cycles(id),
    user_id       BIGINT    NOT NULL REFERENCES users(id),
    enps          TEXT      NOT NULL,  -- encrypted "0".."10"
    driver1       TEXT      NOT NULL,  -- Q2, encrypted "1".."5" | "NA"
    driver2       TEXT      NOT NULL,  -- Q3
    driver3       TEXT      NOT NULL,  -- Q4
    driver4       TEXT      NOT NULL,  -- Q5
    rotating      TEXT      NOT NULL,  -- Q6, encrypted "1".."5" | "NA"
    comment       TEXT      NULL,      -- Q7, encrypted; <= 1000 chars pre-encryption
    submitted_at  BIGINT    NOT NULL,  -- epoch millis of the FIRST submission, immutable
    last_modified BIGINT    NOT NULL,
    UNIQUE (cycle_id, user_id),        -- upsert race backstop (23505 -> central 409)
    FOREIGN KEY (cycle_id, user_id) REFERENCES pulse_participants(cycle_id, user_id)  -- only participants respond
);
CREATE INDEX idx_pulse_responses_cycle_id ON pulse_responses(cycle_id);
