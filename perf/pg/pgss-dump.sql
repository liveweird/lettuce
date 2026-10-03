-- Top statements of one measurement window (perf/run.sh pgss dump <label>): the 50 costliest by total time
-- UNION the 50 most frequent by calls (a cheap statement repeated per row never makes a top-by-time list, and
-- repetition is exactly what an N+1 looks like). pg_stat_statements normalizes constants to $n, so no bind
-- value reaches the file. The dump's own queries and the extension's views are excluded.
COPY (
  WITH s AS (
    SELECT queryid, calls, total_exec_time, mean_exec_time, max_exec_time, rows,
           shared_blks_hit, shared_blks_read, left(regexp_replace(query, '\s+', ' ', 'g'), 400) AS query
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND query NOT ILIKE '%pg_stat_statements%' AND query NOT ILIKE '%pg_stat_user_tables%'
      AND query NOT ILIKE 'COPY (%' AND query !~* '^(BEGIN|COMMIT|ROLLBACK|SET |SHOW |DEALLOCATE)'
  ), ranked AS (
    SELECT s.*,
           rank() OVER (ORDER BY total_exec_time DESC) AS rank_total,
           rank() OVER (ORDER BY calls DESC) AS rank_calls
    FROM s
  )
  SELECT rank_total, rank_calls, queryid, calls, round(total_exec_time::numeric, 1) AS total_exec_ms,
         round(mean_exec_time::numeric, 3) AS mean_exec_ms, round(max_exec_time::numeric, 1) AS max_exec_ms,
         rows, shared_blks_hit, shared_blks_read, query
  FROM ranked
  WHERE rank_total <= 50 OR rank_calls <= 50
  ORDER BY rank_total
) TO STDOUT WITH CSV HEADER;
