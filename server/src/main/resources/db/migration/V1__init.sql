CREATE TABLE cities (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(255),
    population INT
);

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    name          VARCHAR(50)  NOT NULL,
    age           INT          NOT NULL,
    email         VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL
);
