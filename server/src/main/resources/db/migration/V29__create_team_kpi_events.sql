-- Immutable audit trail of team-KPI changes, mirroring goal_events (V26). Rows are minted as a
-- side-effect of KPI create/update/transition/delete (no public create endpoint); there is no
-- update or delete. Events are stored structurally (event_type + a JSON params map) so the SPA
-- can render each one in the viewer's language. Params carry enum names and numeric values only —
-- NEVER title/description/summary text (description and summary are encrypted at rest and must
-- not leak here in plaintext).
CREATE TABLE team_kpi_events (
    id          BIGSERIAL   PRIMARY KEY,
    team_kpi_id BIGINT      NOT NULL REFERENCES team_kpis(id) ON DELETE CASCADE,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at  BIGINT      NOT NULL,
    event_type  VARCHAR(40) NOT NULL,
    params      TEXT        NOT NULL   -- JSON object of string params, e.g. {"from":"DRAFT"}; "{}" when none
);

CREATE INDEX idx_team_kpi_events_team_kpi_id ON team_kpi_events(team_kpi_id);
