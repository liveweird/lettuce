-- Review periods: the global, ADMIN-curated timeline that performance reviews attach to. Each
-- period is a month range (YYYY-MM strings — lexicographic == chronological, the VARCHAR ISO
-- idiom one level up from the date columns). The timeline is append-only and gapless by
-- construction: a new period must start the month right after the latest existing one ends (the
-- first period is free), periods are immutable, and only the LATEST period may be deleted — and
-- only while no performance review references it. Deletion is therefore a HARD delete (a
-- deliberate exception to the soft-delete convention): a soft-deleted period would poison the
-- no-gap adjacency rule, and a deletable period never had dependents. The unique start_month
-- doubles as the concurrency backstop — two racing adjacent creates compute the same start, so
-- the second hits 23505 -> 409.
CREATE TABLE review_periods (
    id          BIGSERIAL  PRIMARY KEY,
    start_month VARCHAR(7) NOT NULL,  -- ISO YYYY-MM, inclusive
    end_month   VARCHAR(7) NOT NULL,  -- ISO YYYY-MM, inclusive; >= start_month
    created_at  BIGINT     NOT NULL   -- epoch millis
);

CREATE UNIQUE INDEX uq_review_periods_start_month ON review_periods(start_month);
