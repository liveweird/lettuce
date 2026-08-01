-- Team KPIs: a manager sets a tracked KPI for a team they manage. Status machine
-- DRAFT <-> ACTIVE <-> CLOSED (both directions, never skipping ACTIVE — the goals machine, V25);
-- every change is recorded in team_kpi_events (V29). The KPI row is the soft-delete unit
-- (DRAFT-only via the API). Unlike goals there is no manager_id column: write access always
-- derives from teams.manager_id at call time, so a reassigned team's new manager takes over its
-- KPIs. No due date, and no BINARY type — the value fields are therefore NOT NULL.
CREATE TABLE team_kpis (
    id                BIGSERIAL        PRIMARY KEY,
    team_id           BIGINT           NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
    created_at        BIGINT           NOT NULL,  -- epoch millis, immutable
    title             VARCHAR(200)     NOT NULL,  -- plaintext: lists sort/filter on it
    description       TEXT             NOT NULL,  -- encrypted at rest (enc:v1:…), never filtered/sorted in SQL
    type              VARCHAR(20)      NOT NULL CHECK (type IN ('NUMBER', 'PERCENTAGE')),
    target_value      DOUBLE PRECISION NOT NULL,
    current_value     DOUBLE PRECISION NOT NULL,
    status            VARCHAR(20)      NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
    summary           TEXT             NULL,      -- encrypted at rest; set by the close action only
    last_modified     BIGINT           NOT NULL,
    marked_as_deleted BOOLEAN          NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_team_kpis_team_id ON team_kpis(team_id);
CREATE INDEX idx_team_kpis_marked_as_deleted ON team_kpis(marked_as_deleted);
