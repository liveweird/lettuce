-- Per-user feature flags (v1.53.0): the DISABLED set — no row = feature enabled, so the
-- empty table needs no backfill and every existing/new user starts with full access.
-- No CHECK on feature: the application enum is the whitelist, so a future feature needs
-- no migration (the V27 user_roles idiom). The feature index backs the admin per-feature
-- screen's users-list filter (feature + featureEnabled).
CREATE TABLE user_disabled_features (
    user_id BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature VARCHAR(30) NOT NULL,
    PRIMARY KEY (user_id, feature)
);
CREATE INDEX idx_user_disabled_features_feature ON user_disabled_features(feature);
