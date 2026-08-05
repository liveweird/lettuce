-- Seed the confirmed Polish statutory public holidays for 2026 and 2027 (v1.43.0) — the
-- fixed dates plus the movable feasts (Easter 2026-04-05 / 2027-03-28 and its derivatives;
-- Christmas Eve is statutory since 2025). Additive and idempotent: ON CONFLICT on the V39
-- unique holiday_date does nothing, so admin-curated rows are never overwritten and re-runs
-- are safe. Days-off request costs are frozen at creation, so this seed never reprices
-- pre-existing requests (documented behavior).
INSERT INTO public_holidays (holiday_date, name, created_at) VALUES
    ('2026-01-01', 'Nowy Rok',                          1754400000000),
    ('2026-01-06', 'Święto Trzech Króli',               1754400000000),
    ('2026-04-05', 'Wielkanoc',                         1754400000000),
    ('2026-04-06', 'Poniedziałek Wielkanocny',          1754400000000),
    ('2026-05-01', 'Święto Pracy',                      1754400000000),
    ('2026-05-03', 'Święto Konstytucji 3 Maja',         1754400000000),
    ('2026-05-24', 'Zielone Świątki',                   1754400000000),
    ('2026-06-04', 'Boże Ciało',                        1754400000000),
    ('2026-08-15', 'Wniebowzięcie Najświętszej Maryi Panny', 1754400000000),
    ('2026-11-01', 'Wszystkich Świętych',               1754400000000),
    ('2026-11-11', 'Narodowe Święto Niepodległości',    1754400000000),
    ('2026-12-24', 'Wigilia Bożego Narodzenia',         1754400000000),
    ('2026-12-25', 'Boże Narodzenie (pierwszy dzień)',  1754400000000),
    ('2026-12-26', 'Boże Narodzenie (drugi dzień)',     1754400000000),
    ('2027-01-01', 'Nowy Rok',                          1754400000000),
    ('2027-01-06', 'Święto Trzech Króli',               1754400000000),
    ('2027-03-28', 'Wielkanoc',                         1754400000000),
    ('2027-03-29', 'Poniedziałek Wielkanocny',          1754400000000),
    ('2027-05-01', 'Święto Pracy',                      1754400000000),
    ('2027-05-03', 'Święto Konstytucji 3 Maja',         1754400000000),
    ('2027-05-16', 'Zielone Świątki',                   1754400000000),
    ('2027-05-27', 'Boże Ciało',                        1754400000000),
    ('2027-08-15', 'Wniebowzięcie Najświętszej Maryi Panny', 1754400000000),
    ('2027-11-01', 'Wszystkich Świętych',               1754400000000),
    ('2027-11-11', 'Narodowe Święto Niepodległości',    1754400000000),
    ('2027-12-24', 'Wigilia Bożego Narodzenia',         1754400000000),
    ('2027-12-25', 'Boże Narodzenie (pierwszy dzień)',  1754400000000),
    ('2027-12-26', 'Boże Narodzenie (drugi dzień)',     1754400000000)
ON CONFLICT (holiday_date) DO NOTHING;
