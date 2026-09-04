# Integration clients — API key lifecycle (v3.0.0)

- **Spec**: [tests/integration-clients.spec.ts](../tests/integration-clients.spec.ts)
- **Actors**: the seed admin (key management), AAA One (a regular user who must see nothing)
- **Owns** (exclusive server-side state): only its own uniquely-named integration clients
  (`E2E-Client-…`). The in-test revoke is the cleanup — revoked rows are inert residue (the
  key stops authenticating, nothing renders outside the admin page), so no sweep or safety
  net is needed. Relies on the compose stack's `INTEGRATION_ENABLED=true` so
  `POST /integration/graphql` is live.

## Scenario: admin creates an integration client, syncs through the GraphQL API with its key, and revokes it

1. The admin signs in and opens Config → Integration clients.
   - *Expected*: the "Integration clients" screen renders (admin-only, the alerts posture).
2. They type a unique client name and press "Add client" (the in-form adder wording).
   - *Expected*: a warning panel "API key for "<name>" — shown only once" appears — the panel
     is the confirmation (no toast, the CreateUser generated-password precedent).
3. They reveal the key with the eye toggle and capture it.
   - *Expected*: the key is masked until revealed and starts with `lettuce_int_` (the
     recognizable prefix; only its SHA-256 digest is stored server-side).
4. A machine client POSTs a GraphQL query (`teams { total }` + `reviewPeriods`) to
   `/integration/graphql` with the key as bearer (driven via the API, not the browser — the
   endpoint is machine-to-machine by design).
   - *Expected*: HTTP 200, no GraphQL errors, and a non-zero team total — the unscoped
     integration read works.
5. The admin presses the row's Revoke icon button and confirms in the modal (the confirm label
   is "Revoke", not Delete — keys are immutable, revoke is the terminal removal).
   - *Expected*: an "API key revoked" toast; the row's status pill flips to Revoked; the Revoke
     button disappears (terminal — no re-enable).
6. The same GraphQL request is repeated with the revoked key.
   - *Expected*: HTTP 401 — revocation is immediate, and every bad-key shape answers the same
     uniform 401.
7. The admin signs out; AAA One (a regular user) signs in and tries the surface.
   - *Expected*: no "Integration clients" nav entry, and navigating to `/integration-clients`
     directly bounces to the dashboard (the admin page guard).
