-- N-language dictionaries (v2.20.0): value_en stays the required default-language column
-- (its partial unique index uq_dictionary_entries_value_en_active remains the DB backstop);
-- every non-EN value moves into a JSON {lang -> value} TEXT map (the notifications-params
-- idiom). Non-EN uniqueness is enforced by the whole-document PUT validation — the payload
-- IS the post-save active set — so the swap-in-one-save 409 limitation narrows to EN.
-- The PL backfill is unconditional (V53's copy-EN rows included): zero API-visible change.
ALTER TABLE dictionary_entries ADD COLUMN translations TEXT NOT NULL DEFAULT '{}';
UPDATE dictionary_entries SET translations = json_build_object('pl', value_pl)::text;
ALTER TABLE dictionary_entries DROP COLUMN value_pl; -- uq_dictionary_entries_value_pl_active drops with it

-- The pulse rotating-question snapshot mirrors the same shape (frozen-at-schedule semantics unchanged).
ALTER TABLE pulse_cycles ADD COLUMN rotating_question_translations TEXT NOT NULL DEFAULT '{}';
UPDATE pulse_cycles SET rotating_question_translations = json_build_object('pl', rotating_question_text_pl)::text
    WHERE rotating_question_text_pl IS NOT NULL;
ALTER TABLE pulse_cycles DROP COLUMN rotating_question_text_pl;
