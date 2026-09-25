### Microsoft Teams notifications (v4.5.0)

The third notification channel, after IN_APP and EMAIL: every minted notification is also
considered for a **Microsoft Teams direct message** (a proactive 1:1 message from a
notification-only bot) in Microsoft 365's public cloud. It is the email mirror's twin — same mint
chokepoint, same fire-and-forget posture, same per-type preference switches — with two extra
gates:

- **The deployment switch** `teams.transport` (`$TEAMS_TRANSPORT`, default `disabled`): nothing is
  sent, and nobody sees a Teams column, until an operator configures a bot. Values: `disabled`,
  `log` (development only — messages go to the `ch.nokillswit.teams` logger; production refuses
  it), `botframework` (real delivery).
- **The per-user feature flag** `TEAMS_NOTIFICATIONS`: the second **inverted-default** flag after
  `MFA` — `V85` seeds it disabled for every existing user and `UserService.create` inserts the
  disabled row for every new one, so an admin opts people in on the per-user editor or the
  `/feature-flags` bulk screen. It gates the CHANNEL only: no route names it in
  `requireFeatureEnabled`, and no `NotificationType.feature` maps to it. Mind the wholesale-replace
  PUT (the MFA trap): a disabled set that omits it — including the "empty array re-enables
  everything" idiom — ENABLES Teams for that user.

The recipient then mutes it per type like any channel (`TEAMS` in
`user_notification_preferences`, the V84 matrix; `V85` widened that table's channel CHECK). The
preferences page renders the Teams column only when the server-computed `teamsAvailable` is true
(transport configured AND the target has the flag).

#### How a message is sent

Microsoft facts behind the design (checked 2026-09-25 against
https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages
and https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication):

- A DM is a **bot's proactive 1:1 message**. Graph cannot send chat messages with application
  permissions, and incoming webhooks/Workflows only post to channels.
- Teams **cannot address a user by email or UPN** — it needs the user's Entra object id. Lettuce
  resolves it from the user's Lettuce email via Microsoft Graph
  (`GET /v1.0/users/{email}?$select=id`, falling back to `$filter=mail eq '…'`), which needs only the
  least-privileged application permission **User.ReadBasic.All** (`id`, `mail` and
  `userPrincipalName` are basic-profile properties). A `$filter` that matches more than one
  directory object (a guest and a member sharing an address) is treated as unreachable, never
  guessed.
- Tokens are client-credentials tokens for a **single-tenant** app registration
  (`POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`, scopes
  `https://api.botframework.com/.default` and `https://graph.microsoft.com/.default`), cached per
  scope and refreshed before expiry.
- The conversation is created once (`POST {serviceUrl}/v3/conversations` with the object id and
  tenant) and its id cached; each message is `POST {serviceUrl}/v3/conversations/{id}/activities`.
- **The bot app must be installed for the user in personal scope.** Otherwise Teams answers 403
  `ForbiddenOperationException`; a user who blocked the bot answers 403 `MessageWritesBlocked`.
- The bot is **notification-only**: Lettuce never receives traffic from Teams, so it exposes no
  inbound endpoint and never has to verify Bot Framework tokens.

Per-user identity state lives in `user_teams_identities` (V85 — a cache, hard-deleted/upserted:
the resolved object id, the conversation id, and an `unreachable_until` back-off). A stored email
that no longer matches the user's current email invalidates the row. An unreachable result (user
not found in the directory, app not installed, bot blocked) is retried only after
`teams.unreachableRetryHours` (default 24), so a user without the app is not probed on every
notification.

The text is the email catalog's wording (`notificationEmailContent`, in the recipient's language):
subject, a blank line, then the body with the `mail.appUrl` deep link — sent with
`textFormat: "plain"` (Bot Framework defaults to markdown), so a display name such as
`[Reset your password](https://…)` renders as literal text, never as a link. **Data
processing:** the text is the email mirror's content class (party names, titles, dates, KPI
values, the deep link — never feedback/goal/review/impact content), but it is stored in
Microsoft's Teams chat store rather than the organization's mail system; enabling the channel
is that data-processing decision.

#### Local development without a tenant

`docker compose up` runs **`teams-stub`**, a WireMock server answering the three Microsoft
endpoints from the mappings in `dev/teams-stub/`; the compose app points the three base URLs at
it (development mode only — see the production URL pinning below). Every message the app sends
lands in the stub's request journal: `http://localhost:8089/__admin/requests`. A member id
containing `teams-not-installed` answers the real 403 `ForbiddenOperationException`, so the
unreachable path can be exercised too.

What the stub **cannot** prove — and a first real tenant must: how Teams actually renders the
text, the admin consent and app-installation policy, and a non-default regional service URL.

#### Setting up a real tenant (runbook)

Done by the Microsoft 365 / Entra administrator, once per tenant:

1. **Create an Azure Bot resource** (Azure portal → "Azure Bot"), type **Single Tenant**, with a
   new Entra app registration. Note the **Microsoft App ID** and the **Directory (tenant) ID**, and
   create a **client secret** on the app registration (Certificates & secrets). The messaging
   endpoint can stay empty — the bot never receives messages.
2. **Enable the Microsoft Teams channel** on the Azure Bot resource (Channels → Microsoft Teams,
   the commercial cloud).
3. **Grant the Graph permission**: on the app registration, API permissions → Microsoft Graph →
   **Application** permission **User.ReadBasic.All** → *Grant admin consent*. (This is the
   least-privileged permission for the two lookups Lettuce makes; confirm on the first tenant
   that the lookup succeeds with it.)
4. **Build the Teams app package** from `deploy/teams-app/manifest.template.json`: replace the
   placeholders (a fresh GUID for `id`, the App ID from step 1 as `botId`, your organization and
   host), add a 192×192 `color.png` and a 32×32 transparent `outline.png`, and zip the three
   files (no folder inside the zip).
5. **Upload it to the org app catalog** (Teams admin center → Teams apps → Manage apps → Upload
   new app) and **install it for the users** who should receive messages — an app setup policy
   (Teams apps → Setup policies → Installed apps) is the scalable way. A user without the app is
   simply unreachable (logged, backed off, never an error to anyone).
6. **Configure Lettuce**: `TEAMS_TRANSPORT=botframework`, `TEAMS_TENANT_ID`, `TEAMS_APP_ID`, and
   `TEAMS_APP_SECRET` (a secret — in Kubernetes put it in `lettuce-secrets`, never in the
   ConfigMap). Leave the three base URLs at their defaults; production refuses anything else.
7. **Enable the per-user flag** for a first pilot user (Users → the person → Modify → Features, or
   `/feature-flags`).
8. **Verify**: as that pilot user, change your own password. `PASSWORD_CHANGED` is locked on for
   every channel, so a Teams DM must arrive. If it doesn't, the `ch.nokillswit.teams` log line
   names the failing step (`token`, `graph_lookup`, `graph_filter`, `conversation`, `send`) and
   the HTTP status; an unreachable recipient is logged at INFO with the reason (`not_installed`,
   `blocked`, `user_not_found`, `ambiguous`) and the back-off end. Once the cause is fixed (for
   example the app is installed), clear the back-off early with
   `DELETE FROM user_teams_identities WHERE user_id = <id>`.

#### Security posture

- **Fail-closed boot** (`infra/teams/Teams.kt`): an unknown transport, or `botframework` with a
  blank tenant/app id/secret, refuses to start in any mode; `log` refuses in production; and **in
  production the three base URLs must equal Microsoft's public-cloud defaults** — the client secret
  is posted to the login URL, so an overridden URL would hand it to whoever runs that host.
  Overrides exist for the local stub only.
- Only outbound HTTPS to Microsoft; no inbound endpoint. Requests time out
  (`teams.requestTimeoutSeconds`, default 10) and a 429 is retried once after `Retry-After`
  (capped at 10 s).
- Logs carry the failing step, the HTTP status, the recognized Teams sub-code and the Lettuce
  user id — **never the secret, a token, or a response body**. Response bodies are read up to
  64 KiB; redirects are never followed (the JDK `HttpClient` default), so a redirect from the
  token endpoint can never re-post the secret elsewhere.
- The message text is the same content class as the email mirror: party names, titles and dates,
  never feedback/goal/review content.

#### Rolling back past V85

Flyway has no down migrations, and a pre-v4.5.0 build cannot read the names V85 introduced: every
user carries a `TEAMS_NOTIFICATIONS` flag row, which v4.4.x decodes with a strict `valueOf` —
sign-in and every user read would fail. Before starting an older image against a database V85
has run on, remove them:

```sql
DELETE FROM user_disabled_features WHERE feature = 'TEAMS_NOTIFICATIONS';
DELETE FROM user_notification_preferences WHERE channel = 'TEAMS';
```

(the `user_teams_identities` table and the widened CHECK are harmless to an older build). Sessions signed in under v4.5.0 carry the new flag in their tokens, which an older build rejects as unknown, so every user signs in again once after the rollback — expected, and harmless. From
v4.5.0 on, the feature-flag and channel readers drop unknown stored names instead of throwing
(the v3.25.3 open-set rule), so a later opt-in flag won't need this step.

#### Tests

`BotFrameworkTeamsMessengerTest` (the exact documented request shapes against an in-process fake
of login/Graph/connector, plus every error path and a no-secret-in-logs assertion),
`NotificationTeamsDeliveryTest` (the send-time skip order), `TeamsConfigTest` (the boot rules),
`NotificationPreferencesTest` (the `teams` column and `teamsAvailable`), the SPA preferences
tests, and `e2e/tests/teams-notifications.spec.ts` (a real notification arriving in the stub's
journal).
