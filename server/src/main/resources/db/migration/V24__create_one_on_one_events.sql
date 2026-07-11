-- Immutable audit trail of 1:1 meeting changes, mirroring feedback_events (V15). Rows are minted
-- as a side-effect of meeting create/update/delete (no public create endpoint); there is no update
-- or delete. Events are stored structurally (event_type + a JSON params map) so the SPA can render
-- each one in the viewer's language. Params carry positions/dates/enum names only — NEVER item
-- text, which is encrypted at rest in the detail tables and must not leak here in plaintext.
CREATE TABLE one_on_one_events (
    id         BIGSERIAL   PRIMARY KEY,
    meeting_id BIGINT      NOT NULL REFERENCES one_on_one_meetings(id) ON DELETE CASCADE,
    user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at BIGINT      NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    params     TEXT        NOT NULL   -- JSON object of string params, e.g. {"position":"2"}; "{}" when none
);

CREATE INDEX idx_one_on_one_events_meeting_id ON one_on_one_events(meeting_id);
