-- Application settings (v2.0.0): the app's first runtime-editable configuration store —
-- a generic key/value table so future settings reuse it without another migration. Unlike
-- application.yaml/env config (read once at boot), these values are read per request and
-- editable by an ADMIN through the API. Config, not user data: rows hard-upsert and never
-- soft-delete (the registries' justified-exception idiom). No CHECK on key: the application
-- owns the whitelist (the V27/V46 idiom). The seed is idempotent and additive — an
-- admin-edited value is never overwritten by a re-run.
CREATE TABLE app_settings (
    key   VARCHAR(100) PRIMARY KEY,
    value VARCHAR(200) NOT NULL
);

INSERT INTO app_settings (key, value) VALUES
    ('pulse.cadenceWeeks', '4'),
    ('pulse.openDays', '7')
ON CONFLICT (key) DO NOTHING;
