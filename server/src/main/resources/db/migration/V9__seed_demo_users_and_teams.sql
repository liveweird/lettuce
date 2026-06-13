-- TEMPLATE PLACEHOLDER: this seed creates a small demo org so the Dashboard lists
-- have data to show. Replace or delete before any non-development use.
-- Every demo user logs in with password "changeme" (reusing the V6 cost-12 bcrypt
-- hash). All demo users have role USER.
--
-- Structure:
--   AAA — team of three (aaa-one/two/three), managed by Manager AAA
--   BBB — team of three (bbb-one/two/three), managed by Manager BBB
--   CCC — team of two whose members are Manager AAA and Manager BBB,
--         managed by Manager CCC (who is a member of no other team)

INSERT INTO users (name, email, password_hash, role) VALUES
    ('AAA One',     'aaa-one@lettuce.local',     '$2y$12$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya', 'USER'),
    ('AAA Two',     'aaa-two@lettuce.local',     '$2y$12$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya', 'USER'),
    ('AAA Three',   'aaa-three@lettuce.local',   '$2y$12$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya', 'USER'),
    ('BBB One',     'bbb-one@lettuce.local',     '$2y$12$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya', 'USER'),
    ('BBB Two',     'bbb-two@lettuce.local',     '$2y$12$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya', 'USER'),
    ('BBB Three',   'bbb-three@lettuce.local',   '$2y$12$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya', 'USER'),
    ('Manager AAA', 'manager-aaa@lettuce.local', '$2y$12$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya', 'USER'),
    ('Manager BBB', 'manager-bbb@lettuce.local', '$2y$12$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya', 'USER'),
    ('Manager CCC', 'manager-ccc@lettuce.local', '$2y$12$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya', 'USER')
ON CONFLICT (email) DO NOTHING;

-- Teams (idempotent: only inserted when a team of that name does not already exist).
INSERT INTO teams (name, manager_id)
SELECT 'AAA', u.id FROM users u WHERE u.email = 'manager-aaa@lettuce.local'
    AND NOT EXISTS (SELECT 1 FROM teams WHERE name = 'AAA');

INSERT INTO teams (name, manager_id)
SELECT 'BBB', u.id FROM users u WHERE u.email = 'manager-bbb@lettuce.local'
    AND NOT EXISTS (SELECT 1 FROM teams WHERE name = 'BBB');

INSERT INTO teams (name, manager_id)
SELECT 'CCC', u.id FROM users u WHERE u.email = 'manager-ccc@lettuce.local'
    AND NOT EXISTS (SELECT 1 FROM teams WHERE name = 'CCC');

-- Memberships.
INSERT INTO team_members (team_id, user_id)
SELECT t.id, u.id FROM teams t, users u
WHERE t.name = 'AAA'
    AND u.email IN ('aaa-one@lettuce.local', 'aaa-two@lettuce.local', 'aaa-three@lettuce.local')
ON CONFLICT (team_id, user_id) DO NOTHING;

INSERT INTO team_members (team_id, user_id)
SELECT t.id, u.id FROM teams t, users u
WHERE t.name = 'BBB'
    AND u.email IN ('bbb-one@lettuce.local', 'bbb-two@lettuce.local', 'bbb-three@lettuce.local')
ON CONFLICT (team_id, user_id) DO NOTHING;

INSERT INTO team_members (team_id, user_id)
SELECT t.id, u.id FROM teams t, users u
WHERE t.name = 'CCC'
    AND u.email IN ('manager-aaa@lettuce.local', 'manager-bbb@lettuce.local')
ON CONFLICT (team_id, user_id) DO NOTHING;
