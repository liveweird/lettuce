CREATE TABLE feedbacks (
    id           BIGSERIAL    PRIMARY KEY,
    requester_id BIGINT       NULL     REFERENCES users(id) ON DELETE SET NULL,
    subject_id   BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider_id  BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    visibility   VARCHAR(40)  NOT NULL CHECK (visibility IN (
        'PROVIDER_SUBJECT',
        'PROVIDER_REQUESTER',
        'PROVIDER_REQUESTER_SUBJECT',
        'PUBLIC'
    )),
    status       VARCHAR(20)  NOT NULL CHECK (status IN (
        'REQUESTED', 'DRAFT', 'SENT', 'WITHDRAWN'
    )),
    content      TEXT         NOT NULL DEFAULT ''
);
CREATE INDEX idx_feedbacks_subject_id   ON feedbacks(subject_id);
CREATE INDEX idx_feedbacks_provider_id  ON feedbacks(provider_id);
CREATE INDEX idx_feedbacks_requester_id ON feedbacks(requester_id);
