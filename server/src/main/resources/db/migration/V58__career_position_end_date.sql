-- v2.17.0: a stored end date on a career position — the ONE exception to V57's start-only
-- model. Written exclusively by account deactivation (the final active position is closed on
-- the deactivation date) and cleared by reactivation; managers never set it through the API.
-- Only the user's FINAL active row ever carries a value (a new position cannot be recorded
-- for a deactivated user, and deleting the stamped row transfers the stamp to the surviving
-- final row); non-final rows keep their derived end (day before the next row's start).
-- Same strict zero-padded ISO VARCHAR idiom as start_date (lexicographic == chronological).
ALTER TABLE user_career_positions ADD COLUMN end_date VARCHAR(10) NULL;
