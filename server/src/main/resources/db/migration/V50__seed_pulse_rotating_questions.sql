-- Seeds the pulse rotating-question bank (Q6) as the fourth global dictionary (the V32
-- idiom). Idempotent and additive: the conflict target names V31's partial unique index over
-- active rows, so admin-curated entries are left alone. Every entry must read as a statement
-- answerable on the five-point agreement scale — the survey renders whatever text is active
-- here, one per cycle, picked least-used-first at schedule time.
INSERT INTO dictionary_entries (dictionary, position, value) VALUES
    ('PULSE_ROTATING_QUESTION', 0, 'Good work is recognized here.'),
    ('PULSE_ROTATING_QUESTION', 1, 'I have worthwhile opportunities to learn and develop.'),
    ('PULSE_ROTATING_QUESTION', 2, 'I feel that I belong on my team.'),
    ('PULSE_ROTATING_QUESTION', 3, 'Leadership communicates important decisions clearly.'),
    ('PULSE_ROTATING_QUESTION', 4, 'I have the tools and information needed to work effectively.'),
    ('PULSE_ROTATING_QUESTION', 5, 'Recent organizational changes have been managed effectively.')
ON CONFLICT (dictionary, value) WHERE marked_as_deleted = false DO NOTHING;
