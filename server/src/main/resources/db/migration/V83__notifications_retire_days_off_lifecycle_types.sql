-- v3.25.3: converts the notification rows that v3.9.0 orphaned.
--
-- v3.9.0 removed the days-off request/approval lifecycle and with it seven NotificationType
-- values, but V77 (that release's migration) rewrote only days_off_requests — never
-- notifications.notification_type, which stores the enum NAME as a plain varchar. On any
-- database upgraded past v3.9.0, every surviving row of those seven kinds threw
-- IllegalArgumentException in NotificationType.valueOf, 500-ing the recipient's whole list and
-- the bell badge with it (there is no separate unseen-count endpoint). V37, the
-- GOAL_CLOSED -> GOAL_ARCHIVED rename, is the precedent this should have followed.
--
-- The mapping deliberately MIRRORS what V77 did to the underlying entry, rather than inventing
-- its own: the kinds whose entry V77 kept as an active entry become DAYS_OFF_CREATED, and the
-- kinds whose entry V77 soft-deleted become DAYS_OFF_DELETED. For ACCEPTED/REJECTED that is a
-- RE-LABELLING, not a translation — approval no longer exists as a concept, so the honest thing
-- to show the recipient is the state their entry is actually in.
--
-- params are reshaped to the v3.9.0 fan-out's shape ({person, startDate, endDate}), so a
-- converted row renders through exactly the same i18n key as a freshly minted one. `person` is
-- recoverable for all seven: the _TO_MANAGER kinds carry the owner in params.requester, and on
-- the _TO_OWNER kinds the recipient IS the owner, so users.name supplies it (plaintext, and the
-- FK is ON DELETE RESTRICT, so the row is always there — soft-deleted users included). The
-- v3.2.1 teammate-redaction rule is honoured by construction: `type`/`pool` are dropped.
--
-- jsonb_exists(...) rather than the `?` operator on purpose — a literal `?` in a Flyway SQL
-- migration is a JDBC placeholder hazard. A row missing either date (none expected) is simply
-- left behind, where NotificationService.knownType() renders it invisible instead of fatal.
-- Idempotent: a no-op on a fresh install and on any database already past this migration —
-- a converted row no longer matches the IN (...) list.
--
-- The params cast is guarded by pg_input_is_valid inside a CASE rather than written as a bare
-- `n.params::jsonb`, because a FAILED migration is strictly worse than the bug being fixed: it
-- rolls back and refuses startup on every replica, where the bug was only a per-request 500.
-- params has been written exclusively by encodeParams since V13 created the table, so invalid
-- JSON should not exist — but this migration's whole subject is a database holding rows an
-- earlier release did not anticipate, so it declines to assume. CASE is the load-bearing part:
-- Postgres documents its conditions as evaluated in order, whereas a plain chain of ANDed
-- predicates may be reordered, which would let the cast throw before the guard ran.
--
-- The migration handles only names known TODAY; anything else it leaves for knownType() to
-- hide. The two halves are complementary, not redundant.

UPDATE notifications n SET
    notification_type = 'DAYS_OFF_CREATED',
    params = jsonb_build_object(
        'person',    COALESCE(n.params::jsonb ->> 'requester', u.name),
        'startDate', n.params::jsonb ->> 'startDate',
        'endDate',   n.params::jsonb ->> 'endDate')::text
FROM users u
WHERE u.id = n.recipient_id
  AND n.notification_type IN ('DAYS_OFF_REQUESTED_TO_MANAGER',
                              'DAYS_OFF_RECORDED_TO_OWNER',
                              'DAYS_OFF_RECORDED_TO_MANAGER',
                              'DAYS_OFF_ACCEPTED_TO_OWNER')
  AND CASE WHEN pg_input_is_valid(n.params, 'jsonb')
           THEN jsonb_exists(n.params::jsonb, 'startDate') AND jsonb_exists(n.params::jsonb, 'endDate')
           ELSE false END;

UPDATE notifications n SET
    notification_type = 'DAYS_OFF_DELETED',
    params = jsonb_build_object(
        'person',    COALESCE(n.params::jsonb ->> 'requester', u.name),
        'startDate', n.params::jsonb ->> 'startDate',
        'endDate',   n.params::jsonb ->> 'endDate')::text
FROM users u
WHERE u.id = n.recipient_id
  AND n.notification_type IN ('DAYS_OFF_REJECTED_TO_OWNER',
                              'DAYS_OFF_CANCELLED_TO_OWNER',
                              'DAYS_OFF_CANCELLED_TO_MANAGER')
  AND CASE WHEN pg_input_is_valid(n.params, 'jsonb')
           THEN jsonb_exists(n.params::jsonb, 'startDate') AND jsonb_exists(n.params::jsonb, 'endDate')
           ELSE false END;
