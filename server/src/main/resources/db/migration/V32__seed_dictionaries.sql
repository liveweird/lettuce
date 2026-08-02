-- Seeds the three global dictionaries with sensible defaults so a freshly built database
-- has ready-to-use values (the V14 default-templates idiom). Idempotent and additive: the
-- conflict target names V31's partial unique index over active rows, so values an admin
-- already entered are left alone and everything else is inserted. Positions are 0-based in
-- the intended display order (the service convention); reads order by (position, id), so a
-- tie with pre-existing curated rows is harmless and the next admin save renumbers anyway.

INSERT INTO dictionary_entries (dictionary, position, value) VALUES
    ('CAREER_PATH', 0, 'Software Engineer'),
    ('CAREER_PATH', 1, 'System Analyst'),
    ('CAREER_PATH', 2, 'QA Engineer'),
    ('CAREER_PATH', 3, 'QA Specialist'),
    ('CAREER_SPECIALIZATION', 0, 'N/A'),
    ('CAREER_SPECIALIZATION', 1, 'Java'),
    ('CAREER_SPECIALIZATION', 2, 'Python'),
    ('CAREER_SPECIALIZATION', 3, 'PHP'),
    ('CAREER_SPECIALIZATION', 4, 'Front-End'),
    ('SENIORITY_LEVEL', 0, 'Associate'),
    ('SENIORITY_LEVEL', 1, 'Junior'),
    ('SENIORITY_LEVEL', 2, 'Regular'),
    ('SENIORITY_LEVEL', 3, 'Senior'),
    ('SENIORITY_LEVEL', 4, 'Senior Plus'),
    ('SENIORITY_LEVEL', 5, 'Staff'),
    ('SENIORITY_LEVEL', 6, 'Staff Plus'),
    ('SENIORITY_LEVEL', 7, 'Principal')
ON CONFLICT (dictionary, value) WHERE marked_as_deleted = false DO NOTHING;
