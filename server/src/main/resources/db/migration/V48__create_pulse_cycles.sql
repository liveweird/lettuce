-- Pulse survey cycles (v2.0.0): one row per admin-scheduled survey round. Status machine:
-- SCHEDULED -> OPEN -> CLOSED, with terminal CANCELLED reachable from any of the three
-- (cancelling a CLOSED cycle retracts its results; stored responses are kept for audit).
-- All transitions are MANUAL admin actions — the planned_* dates are advisory prefills, the
-- app has no background jobs and none may act on them. The rotating question (Q6) is picked
-- at schedule time from the PULSE_ROTATING_QUESTION dictionary and its text is SNAPSHOTTED
-- here: later renames of the dictionary entry never rewrite what a cycle actually asked.
-- Soft-delete column per convention, but there is NO delete endpoint — cancel is the
-- user-facing removal (the days_off_requests precedent).
CREATE TABLE pulse_cycles (
    id                         BIGSERIAL    PRIMARY KEY,
    status                     VARCHAR(20)  NOT NULL CHECK (status IN ('SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED')),
    planned_open_date          VARCHAR(10)  NOT NULL,  -- ISO YYYY-MM-DD, advisory
    planned_close_date         VARCHAR(10)  NOT NULL,  -- ISO YYYY-MM-DD, advisory; admin-editable while OPEN ("extend")
    rotating_question_entry_id BIGINT       NOT NULL REFERENCES dictionary_entries(id),  -- no ON DELETE: entries never hard-delete
    rotating_question_text     VARCHAR(100) NOT NULL,  -- snapshot at schedule time
    created_at                 BIGINT       NOT NULL,  -- epoch millis
    opened_at                  BIGINT       NULL,
    closed_at                  BIGINT       NULL,
    cancelled_at               BIGINT       NULL,
    last_modified              BIGINT       NOT NULL,
    marked_as_deleted          BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_pulse_cycles_marked_as_deleted ON pulse_cycles(marked_as_deleted);
CREATE INDEX idx_pulse_cycles_status ON pulse_cycles(status);

-- At most ONE non-terminal (SCHEDULED or OPEN) cycle may exist at a time: a partial unique
-- index over a constant admits a single matching row. Race-proof DB backstop behind the
-- service's 409 pre-check (the review-periods 23505 -> 409 pattern).
CREATE UNIQUE INDEX uq_pulse_cycles_non_terminal ON pulse_cycles((1))
    WHERE status IN ('SCHEDULED', 'OPEN') AND marked_as_deleted = false;
