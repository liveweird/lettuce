-- Days-off requests (v1.42.0): one consecutive [start_date, end_date] period per row, owned by
-- one user. Status machine: REQUESTED -> ACCEPTED | REJECTED (resolved by a current direct
-- manager of the owner) plus terminal CANCELLED (the owner; from REQUESTED anytime, from
-- ACCEPTED only strictly before start_date). Edge half-days via start_half/end_half; a
-- single-day request uses start_half only (end_half must stay false — app-enforced).
-- cost_half_days is the working-day cost in half-day integer units (weekends and public
-- holidays cost nothing), computed against the then-current holiday registry at creation and
-- FROZEN — later registry edits never reprice history. Requests never span calendar years
-- (app-enforced), so the frozen cost attributes to exactly one budget year. REQUESTED and
-- ACCEPTED both reserve paid budget; REJECTED/CANCELLED free it. No events table by design:
-- the single-transition lifecycle is fully carried by created_at/resolved_*/cancelled_at.
CREATE TABLE days_off_requests (
    id                BIGSERIAL   PRIMARY KEY,
    user_id           BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    type              VARCHAR(10) NOT NULL CHECK (type IN ('PAID', 'UNPAID')),
    status            VARCHAR(20) NOT NULL CHECK (status IN ('REQUESTED', 'ACCEPTED', 'REJECTED', 'CANCELLED')),
    start_date        VARCHAR(10) NOT NULL,  -- ISO YYYY-MM-DD, immutable after create
    end_date          VARCHAR(10) NOT NULL,  -- ISO YYYY-MM-DD, >= start_date, same year
    start_half        BOOLEAN     NOT NULL DEFAULT FALSE,
    end_half          BOOLEAN     NOT NULL DEFAULT FALSE,
    cost_half_days    INTEGER     NOT NULL,  -- frozen working-day cost in half-day units
    created_at        BIGINT      NOT NULL,  -- epoch millis, immutable
    resolved_by       BIGINT      NULL REFERENCES users(id),  -- the accepting/rejecting manager
    resolved_at       BIGINT      NULL,      -- epoch millis
    cancelled_at      BIGINT      NULL,      -- epoch millis
    last_modified     BIGINT      NOT NULL,
    marked_as_deleted BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_days_off_requests_user_id ON days_off_requests(user_id);
CREATE INDEX idx_days_off_requests_start_date ON days_off_requests(start_date);
CREATE INDEX idx_days_off_requests_marked_as_deleted ON days_off_requests(marked_as_deleted);
