-- Global public-holiday registry (v1.42.0): ADMIN-curated dates on which everyone is off and
-- no paid budget is deducted. Hard delete (the review_periods registry exception to the
-- soft-delete convention: nothing references holidays by FK, and days-off request costs are
-- FROZEN at creation, so a deleted holiday never reprices history). UNIQUE(holiday_date)
-- backstops racing creates (23505 -> the central 409 mapping) — two holidays on one date are
-- meaningless for costing.
CREATE TABLE public_holidays (
    id            BIGSERIAL    PRIMARY KEY,
    holiday_date  VARCHAR(10)  NOT NULL,  -- ISO YYYY-MM-DD (lexicographic == chronological)
    name          VARCHAR(100) NOT NULL,
    created_at    BIGINT       NOT NULL,  -- epoch millis
    UNIQUE (holiday_date)
);
