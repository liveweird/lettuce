-- Annual paid-days-off allowance (v1.42.0): whole days, ADMIN-only assignable (the V33
-- career-fields precedent — null/omitted on PUT = leave unchanged, clearing inexpressible).
-- NULL = not configured = zero paid budget (PAID requests are 409). The CURRENT value applies
-- to every calendar year — changing it retroactively recomputes carry-over (documented).
-- No index: never filtered or sorted on.
ALTER TABLE users ADD COLUMN paid_days_off_allowance INTEGER NULL;
