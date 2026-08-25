-- Target direction (v2.41.0): whether the tracked value should reach AT_LEAST the target
-- (acquire >= 10 customers) or stay AT_MOST at it (churn <= 5%) — set by the definer on
-- NUMBER/PERCENTAGE goals and every team KPI, and driving the above/below-target cues in the
-- SPA (KPI values list deltas, the graph's good-zone tint, the goal view's current-value cue).
-- goals: nullable — the type-specific-columns convention (PLAN rows carry NULL, like
-- target_value); every existing numeric row (soft-deleted included) backfills to AT_LEAST,
-- the previously implied reading. team_kpis: NOT NULL — a KPI target is always required.
ALTER TABLE goals ADD COLUMN target_direction VARCHAR(20);
UPDATE goals SET target_direction = 'AT_LEAST' WHERE type <> 'PLAN';
ALTER TABLE team_kpis ADD COLUMN target_direction VARCHAR(20) NOT NULL DEFAULT 'AT_LEAST';
