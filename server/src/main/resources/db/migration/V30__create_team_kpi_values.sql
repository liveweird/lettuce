-- Team KPI data points: the collected (date, value) measurements of a team KPI, editable by the
-- team's current manager while the KPI is ACTIVE (add / correct / remove). A hard-delete detail
-- table (the 1:1 notes/action-items precedent) — the audit trail lives in team_kpi_events
-- (VALUE_RECORDED / VALUE_CORRECTED / VALUE_REMOVED), not here. Dates are strict ISO YYYY-MM-DD
-- strings (lexicographic == chronological), today or the past, never the future; at most one
-- value per date per KPI. Values and dates are plaintext by design (like target_value — the
-- graph and lists need them). team_kpis.current_value(_date) is recomputed from the max-dated
-- row here on every mutation.
CREATE TABLE team_kpi_values (
    id          BIGSERIAL        PRIMARY KEY,
    team_kpi_id BIGINT           NOT NULL REFERENCES team_kpis(id) ON DELETE CASCADE,
    value_date  VARCHAR(10)      NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    CONSTRAINT uq_team_kpi_values_kpi_date UNIQUE (team_kpi_id, value_date)
);
