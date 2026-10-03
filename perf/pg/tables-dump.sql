-- Per-table access counters of one measurement window (perf/run.sh pgss dump <label>): `pgss reset` zeroes the
-- statistics with pg_stat_reset(), so these ARE the window's deltas. seq_scan > 0 with a large seq_tup_read is
-- the sign of a table read without an index. `est_rows` is pg_class.reltuples — pg_stat_reset() also zeroes
-- n_live_tup, so that column would be meaningless after a reset.
COPY (
  SELECT t.relname, t.seq_scan, t.seq_tup_read, t.idx_scan, t.idx_tup_fetch,
         t.n_tup_ins, t.n_tup_upd, t.n_tup_del, c.reltuples::bigint AS est_rows,
         pg_size_pretty(pg_total_relation_size(t.relid)) AS total_size
  FROM pg_stat_user_tables t JOIN pg_class c ON c.oid = t.relid
  WHERE t.schemaname = 'public' AND (t.seq_scan > 0 OR t.idx_scan > 0)
  ORDER BY t.seq_tup_read DESC, t.idx_scan DESC
) TO STDOUT WITH CSV HEADER;
