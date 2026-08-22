-- Canonical email identity (v2.35.0, monkey-test MT-001): the application now folds every
-- email to lower(trim(...)) at all entry points (create, update, import, login, password
-- reset, lookup). Normalize pre-existing rows once so exact-match lookups keep finding them.
-- A fold collision between two ACTIVE rows would trip uq_users_email_active and fail this
-- migration loudly — by design: such a pair is exactly the duplicate-identity state the
-- canonicalization removes, and it needs a human decision (none can exist on the seeds).
UPDATE users
SET email = lower(btrim(email))
WHERE email <> lower(btrim(email));
