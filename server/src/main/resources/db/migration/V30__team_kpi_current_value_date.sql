-- The date (ISO YYYY-MM-DD, user-supplied, never in the future) of the latest-dated recorded
-- value. NULL = no value has ever been recorded (pre-existing rows, fresh DRAFTs, and after a
-- type-change reset). A backdated progress update older than this date lands in the audit events
-- (and hence the graph) without overwriting current_value ("latest-dated wins").
ALTER TABLE team_kpis ADD COLUMN current_value_date VARCHAR(10);
