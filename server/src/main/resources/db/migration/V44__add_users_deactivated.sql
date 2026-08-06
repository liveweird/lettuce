-- Reversible account deactivation (v1.48.0). Unlike the V7 soft-delete, a deactivated user
-- keeps their email reserved (the V18 partial unique index deliberately ignores this column),
-- stays fully visible in historical data with unchanged rights, and can be reactivated by an
-- admin at any time (POST /api/v1/users/{id}/activate). The flag blocks login (403 after the
-- password verifies — no enumeration oracle), refresh, self-service password reset, and NEW
-- assignments (team member/manager, goal/1:1/review subordinate, feedback party) — existing
-- rows are untouched. See "Authorization model" in .claude/docs/authorization.md.
-- No index: the only filter on this column is the admin /users list's status filter, which
-- already seq-scans its substring filters on this small table (the V38 no-index precedent).
ALTER TABLE users ADD COLUMN deactivated BOOLEAN NOT NULL DEFAULT FALSE;
