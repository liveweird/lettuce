-- Bilingual dictionaries (v2.6.0): every dictionary entry carries an English AND a Polish
-- value, and clients render the viewer's language. `value` becomes `value_en`; `value_pl`
-- backfills as a copy of the English text, then the KNOWN seed values (V32 career + V50
-- pulse questions, matched by their current English text so admin-renamed rows are left
-- alone) receive real Polish translations. Seniority levels and language names deliberately
-- keep the English loanwords — that is how the Polish IT market speaks (the declined
---"feedback" convention). Uniqueness becomes per-language: two partial unique indexes over
-- active rows replace V31's single one. The old V32/V50 seeds keep naming `(dictionary,
-- value)` in their conflict targets — they run before this migration, so their checksums
-- and behavior are untouched.
--
-- The pulse snapshot pair follows: `rotating_question_text` becomes `_en`, and `_pl`
-- backfills from the referenced entry's NEW Polish value. For cycles scheduled before this
-- migration that is a deliberate one-time deviation from strict snapshot semantics — the
-- Polish text did not exist when they were scheduled (translated seeds land right above,
-- so historical cycles pick up the real translation, not the English copy).

ALTER TABLE dictionary_entries RENAME COLUMN value TO value_en;
ALTER TABLE dictionary_entries ADD COLUMN value_pl VARCHAR(100);
UPDATE dictionary_entries SET value_pl = value_en;

UPDATE dictionary_entries SET value_pl = 'Inżynier oprogramowania'
    WHERE dictionary = 'CAREER_PATH' AND value_en = 'Software Engineer';
UPDATE dictionary_entries SET value_pl = 'Analityk systemowy'
    WHERE dictionary = 'CAREER_PATH' AND value_en = 'System Analyst';
UPDATE dictionary_entries SET value_pl = 'Inżynier QA'
    WHERE dictionary = 'CAREER_PATH' AND value_en = 'QA Engineer';
UPDATE dictionary_entries SET value_pl = 'Specjalista QA'
    WHERE dictionary = 'CAREER_PATH' AND value_en = 'QA Specialist';
UPDATE dictionary_entries SET value_pl = 'Nie dotyczy'
    WHERE dictionary = 'CAREER_SPECIALIZATION' AND value_en = 'N/A';
UPDATE dictionary_entries SET value_pl = 'Front-end'
    WHERE dictionary = 'CAREER_SPECIALIZATION' AND value_en = 'Front-End';
UPDATE dictionary_entries SET value_pl = 'Dobra praca jest tu doceniana.'
    WHERE dictionary = 'PULSE_ROTATING_QUESTION' AND value_en = 'Good work is recognized here.';
UPDATE dictionary_entries SET value_pl = 'Mam wartościowe możliwości nauki i rozwoju.'
    WHERE dictionary = 'PULSE_ROTATING_QUESTION' AND value_en = 'I have worthwhile opportunities to learn and develop.';
UPDATE dictionary_entries SET value_pl = 'Czuję, że jestem częścią swojego zespołu.'
    WHERE dictionary = 'PULSE_ROTATING_QUESTION' AND value_en = 'I feel that I belong on my team.';
UPDATE dictionary_entries SET value_pl = 'Kierownictwo jasno komunikuje ważne decyzje.'
    WHERE dictionary = 'PULSE_ROTATING_QUESTION' AND value_en = 'Leadership communicates important decisions clearly.';
UPDATE dictionary_entries SET value_pl = 'Mam narzędzia i informacje potrzebne do efektywnej pracy.'
    WHERE dictionary = 'PULSE_ROTATING_QUESTION' AND value_en = 'I have the tools and information needed to work effectively.';
UPDATE dictionary_entries SET value_pl = 'Ostatnie zmiany organizacyjne zostały przeprowadzone sprawnie.'
    WHERE dictionary = 'PULSE_ROTATING_QUESTION' AND value_en = 'Recent organizational changes have been managed effectively.';

ALTER TABLE dictionary_entries ALTER COLUMN value_pl SET NOT NULL;

DROP INDEX uq_dictionary_entries_value_active;
CREATE UNIQUE INDEX uq_dictionary_entries_value_en_active
    ON dictionary_entries(dictionary, value_en)
    WHERE marked_as_deleted = false;
CREATE UNIQUE INDEX uq_dictionary_entries_value_pl_active
    ON dictionary_entries(dictionary, value_pl)
    WHERE marked_as_deleted = false;

ALTER TABLE pulse_cycles RENAME COLUMN rotating_question_text TO rotating_question_text_en;
ALTER TABLE pulse_cycles ADD COLUMN rotating_question_text_pl VARCHAR(100);
UPDATE pulse_cycles pc SET rotating_question_text_pl = de.value_pl
    FROM dictionary_entries de WHERE de.id = pc.rotating_question_entry_id;
ALTER TABLE pulse_cycles ALTER COLUMN rotating_question_text_pl SET NOT NULL;
