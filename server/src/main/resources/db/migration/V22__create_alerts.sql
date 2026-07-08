-- App-wide announcement banners, managed by admins, shown to every user while visible.
-- starts_at / ends_at are epoch millis (same convention as notifications.created_at); NULL = unbounded.
CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    content TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at BIGINT NULL,
    ends_at BIGINT NULL,
    marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_alerts_marked_as_deleted ON alerts(marked_as_deleted);
