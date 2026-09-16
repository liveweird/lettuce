-- v3.9.0: drops the days-off request/approval lifecycle — every user creates an entry directly
-- (no REQUESTED/ACCEPTED/REJECTED/CANCELLED, no accept/reject/cancel); an entry exists until
-- soft-deleted. First retire the rows the removed terminal statuses would otherwise resurrect
-- as active entries (REQUESTED/ACCEPTED rows correctly become plain active entries as-is).
UPDATE days_off_requests SET marked_as_deleted = true WHERE status IN ('REJECTED', 'CANCELLED');

-- Drop the V40 inline status CHECK, then the lifecycle columns themselves. marked_as_deleted
-- (+ its V40 index) stays — it is now the sole state, backing the new DELETE endpoint.
ALTER TABLE days_off_requests DROP CONSTRAINT days_off_requests_status_check;
ALTER TABLE days_off_requests DROP COLUMN status;
ALTER TABLE days_off_requests DROP COLUMN resolved_by;
ALTER TABLE days_off_requests DROP COLUMN resolved_at;
ALTER TABLE days_off_requests DROP COLUMN cancelled_at;
ALTER TABLE days_off_requests DROP COLUMN cancelled_by;
ALTER TABLE days_off_requests DROP COLUMN cancel_reason;
