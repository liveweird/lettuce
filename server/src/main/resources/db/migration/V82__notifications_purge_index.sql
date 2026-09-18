-- v3.12.0: the on-mint stale-notification purge (NotificationService.purgeStale) deletes rows
-- that are seen or user-deleted and older than notifications.retentionDays. A partial index on
-- exactly that predicate keeps the hourly DELETE an index range scan (the V76
-- idx_feedbacks_expires_on precedent). idx_notifications_marked_as_deleted (V17) stays — the
-- list predicate still uses it.
CREATE INDEX idx_notifications_purge ON notifications (created_at)
    WHERE was_seen OR marked_as_deleted;
