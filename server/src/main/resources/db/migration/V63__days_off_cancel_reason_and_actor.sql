-- v2.31.0: cancellation reworked — a request may now be cancelled by the owner OR any manager
-- in their transitive chain (so cancelled_at alone no longer identifies the actor), at any
-- date while REQUESTED/ACCEPTED, and always with a mandatory reason. cancelled_by records the
-- actor (NULL = a pre-rework cancellation, historically always the owner). cancel_reason is
-- free text, encrypted at rest by the application (the days_off_corrections.comment / V54
-- goal_events.comment precedent) — never filtered/sorted in SQL; NULL = cancelled pre-rework.
ALTER TABLE days_off_requests ADD COLUMN cancelled_by BIGINT NULL REFERENCES users(id);
ALTER TABLE days_off_requests ADD COLUMN cancel_reason TEXT NULL;
