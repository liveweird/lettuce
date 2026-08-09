-- MFA (v2.4.0) joins the per-user feature flags with an INVERTED default: opt-in, so every
-- existing user (V6/V9 seeds, soft-deleted and deactivated rows included) starts with the
-- disabled row present. UserService.create inserts the same row for every user created after
-- this migration.
INSERT INTO user_disabled_features (user_id, feature)
SELECT id, 'MFA' FROM users
ON CONFLICT DO NOTHING;
