-- Optional per-user unique id (an employee-id-like reference), ADMIN-assigned.
-- Uniqueness follows the email convention: a partial unique index over active rows only,
-- so a soft-deleted user frees their id. NULLs are distinct under the index, so any number
-- of users may have no id yet.
ALTER TABLE users ADD COLUMN unique_id VARCHAR(50);

CREATE UNIQUE INDEX uq_users_unique_id_active
    ON users(unique_id)
    WHERE marked_as_deleted = false;
