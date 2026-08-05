-- Paid-days budget corrections (v1.43.0): a manager-authored ± adjustment to a subordinate's
-- paid days-off budget for one calendar year, with a mandatory reasoning comment. No approval
-- workflow — the correction takes effect immediately and enters the closed-form carry-over
-- math as a signed half-day amount attributed to its year (an earlier year's correction flows
-- forward automatically). Writes belong to the subordinate's CURRENT direct managers (the
-- accept/reject right); author_id records who created it, display-only. Standard soft-delete
-- entity (the DELETE endpoint flips the flag). The comment is encrypted at rest (enc:v1:…).
CREATE TABLE days_off_corrections (
    id                BIGSERIAL PRIMARY KEY,
    user_id           BIGINT    NOT NULL REFERENCES users(id) ON DELETE RESTRICT,  -- the subordinate
    author_id         BIGINT    NOT NULL REFERENCES users(id),                     -- creating manager
    year              INTEGER   NOT NULL,   -- the budget year the amount applies to
    amount_half_days  INTEGER   NOT NULL,   -- SIGNED half-day units: ADD positive, SUBTRACT negative
    comment           TEXT      NOT NULL,   -- encrypted at rest, never filtered/sorted in SQL
    created_at        BIGINT    NOT NULL,
    last_modified     BIGINT    NOT NULL,
    marked_as_deleted BOOLEAN   NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_days_off_corrections_user_id ON days_off_corrections(user_id);
CREATE INDEX idx_days_off_corrections_marked_as_deleted ON days_off_corrections(marked_as_deleted);
