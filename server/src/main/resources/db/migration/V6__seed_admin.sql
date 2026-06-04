-- TEMPLATE PLACEHOLDER: this seed creates a single bootstrap administrator with
-- a well-known dev password. Replace or delete before any non-development use.
-- Credentials: admin@lettuce.local / changeme
-- The bcrypt hash below was generated with cost=12 from the plaintext "changeme".

INSERT INTO users (name, age, email, password_hash, role)
VALUES (
    'Administrator',
    0,
    'admin@lettuce.local',
    '$2y$12$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya',
    'ADMIN'
)
ON CONFLICT (email) DO NOTHING;
