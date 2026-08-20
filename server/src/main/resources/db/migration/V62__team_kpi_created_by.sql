-- v2.26.0: stamp who created each team KPI. Purely INFORMATIONAL (the list's Creator
-- column) — authorization stays keyed on teams.manager_id + the management chain, never on
-- this column (the user decision: a creator who is no longer the team's manager loses
-- access). Backfill: existing rows predate the column, and their creator was by definition
-- the team's manager at the time — the current manager is the best available approximation
-- (the V53 correlated-UPDATE shape).
ALTER TABLE team_kpis ADD COLUMN created_by BIGINT REFERENCES users(id) ON DELETE RESTRICT;
UPDATE team_kpis SET created_by = t.manager_id FROM teams t WHERE t.id = team_kpis.team_id;
ALTER TABLE team_kpis ALTER COLUMN created_by SET NOT NULL;
