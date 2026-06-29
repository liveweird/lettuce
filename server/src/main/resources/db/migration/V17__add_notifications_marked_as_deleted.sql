ALTER TABLE notifications
    ADD COLUMN marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_notifications_marked_as_deleted ON notifications(marked_as_deleted);
