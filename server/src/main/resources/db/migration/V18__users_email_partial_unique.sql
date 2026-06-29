-- Free the email of soft-deleted users: replace the global UNIQUE(email) with a
-- partial unique index that only constrains active (non-deleted) rows.
ALTER TABLE users DROP CONSTRAINT users_email_key;

CREATE UNIQUE INDEX uq_users_email_active
    ON users(email)
    WHERE marked_as_deleted = false;
