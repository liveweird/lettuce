-- Immutable audit trail of succession-plan changes (v2.46.0), mirroring impact_log_events
-- (V65) / goal_events (V26) — the seventh clone. Rows are minted as a side-effect of plan and
-- nomination mutations (no public create endpoint); there is no update or delete — events
-- outlive a soft-deleted plan (the CASCADE never fires). Events are stored structurally
-- (event_type + a JSON params map) so the SPA renders each one in the viewer's language, and
-- they are readable by exactly the plan's readers (owner / the owner's chain / audited HR —
-- the feature stays invisible to the seat's person and the candidates, history included).
-- Params carry enum names, numbers, and candidate display names only — NEVER loss-impact or
-- competency-gap text (both lists are encrypted at rest and must not leak here in plaintext;
-- candidate identity is already a plaintext FK on succession_nominations, so a name in params
-- is the same disclosure class). Nomination changes are PLAN-level events (one owner FK).
CREATE TABLE succession_plan_events (
    id         BIGSERIAL   PRIMARY KEY,
    plan_id    BIGINT      NOT NULL REFERENCES succession_plans(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at BIGINT      NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    params     TEXT        NOT NULL   -- JSON object of string params, e.g. {"from":"CORE","to":"CRITICAL"}; "{}" when none
);

CREATE INDEX idx_succession_plan_events_plan_id ON succession_plan_events(plan_id);
