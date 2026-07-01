-- Requester's clarification note to the provider, captured when a feedback is requested.
-- Set once at creation; never updated afterward (enforced by FeedbackService.update omitting it).
ALTER TABLE feedbacks ADD COLUMN requester_message TEXT NULL;
