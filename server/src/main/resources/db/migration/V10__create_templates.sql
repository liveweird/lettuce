CREATE TABLE templates (
    id      BIGSERIAL    PRIMARY KEY,
    name    VARCHAR(100) NOT NULL UNIQUE,
    content TEXT         NOT NULL DEFAULT ''
);
