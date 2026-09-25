package ch.nokillswit.infra.teams

import ch.nokillswit.infra.config.requireConfigInt
import io.ktor.server.application.*
import io.ktor.util.AttributeKey

/**
 * The configured [TeamsMessenger], or null when `teams.transport` is `disabled` (the deployment
 * default) — the `infra/mail/MailerKey` idiom: consumers (`notifications/NotificationTeamsSender.kt`)
 * treat null as "the Teams channel is unavailable" and skip every recipient without a warning.
 */
val TeamsMessengerKey = AttributeKey<TeamsMessengerHolder>("TeamsMessenger")

/** AttributeKey cannot hold a nullable type, so the optional messenger travels in a holder. */
class TeamsMessengerHolder(val messenger: TeamsMessenger?)

/** The configured Teams messenger, or null when `teams.transport` is `disabled`. */
fun Application.teamsMessenger(): TeamsMessenger? = attributes[TeamsMessengerKey].messenger

// The Microsoft-documented defaults (send-proactive-messages, bot-framework-rest-connector-
// authentication) — production pins every base URL to these exactly (see configureTeams below).
private const val PRODUCTION_SERVICE_URL = "https://smba.trafficmanager.net/teams/"
private const val PRODUCTION_LOGIN_BASE_URL = "https://login.microsoftonline.com"
private const val PRODUCTION_GRAPH_BASE_URL = "https://graph.microsoft.com"

private fun normalizeUrl(url: String) = url.trim().trimEnd('/')

/**
 * Selects the outbound Microsoft Teams transport from the `teams:` config block and publishes it
 * as [TeamsMessengerKey]. Registered in application.yaml right after `configureMail` — the
 * `infra/mail/Mail.kt` sibling for the third notification channel (v4.5.0).
 *
 * Transports:
 *  - `disabled` (the deployment default, like `integration.enabled`) — the Teams channel is off;
 *    a null messenger is published and every recipient is silently skipped at send time.
 *  - `log` — every call goes to the `ch.nokillswit.teams` logger instead of calling Microsoft.
 *    Permitted in development only (the `mail.transport=log` precedent) — this exists so a
 *    developer with no bot registration can still exercise the delivery code path end to end.
 *  - `botframework` — the real Bot Framework connector + Microsoft Graph transport
 *    ([BotFrameworkTeamsMessenger]). Requires non-blank `tenantId`/`appId`/`appSecret` in EVERY
 *    mode (there is no way for this transport to work without them, so failing fast beats a
 *    deployment discovering it at the first notification).
 *
 * **Production URL pinning.** The three base URLs (`serviceUrl`/`loginBaseUrl`/`graphBaseUrl`)
 * must equal the Microsoft defaults EXACTLY outside development when `botframework` is selected.
 * [appSecret] is POSTed to `loginBaseUrl` on every token request — an overridden login URL in
 * production would exfiltrate the client secret to wherever it points. The override exists
 * exclusively so the local WireMock stub (`teams-stub`, dev-only, see
 * `.claude/docs/features/teams-notifications.md`) can stand in for Microsoft; a real deployment
 * has no reason to ever change these.
 *
 * No network call happens at boot — every check here is pure config validation, the `configureMail`
 * precedent.
 */
fun Application.configureTeams() {
    val config = environment.config
    val transport = config.property("teams.transport").getString().trim().lowercase()
    // Config-shape errors refuse startup in EVERY mode regardless of the selected transport (the
    // `requireConfigInt` contract, shared with the postgres pool bounds and the auth-security
    // knobs) — a malformed numeric override is a deployment mistake, not a runtime concern.
    val requestTimeoutSeconds = requireConfigInt(config, "teams.requestTimeoutSeconds", min = 1, max = 120)
    val unreachableRetryHours = requireConfigInt(config, "teams.unreachableRetryHours", min = 1, max = 720)
    val serviceUrl = config.property("teams.serviceUrl").getString()
    val loginBaseUrl = config.property("teams.loginBaseUrl").getString()
    val graphBaseUrl = config.property("teams.graphBaseUrl").getString()

    val messenger: TeamsMessenger? = when (transport) {
        "disabled" -> null
        "log" -> {
            val message =
                "teams.transport=log writes outbound Teams messages to the application log instead " +
                    "of sending them. Set TEAMS_TRANSPORT=botframework with real bot credentials, or disabled."
            if (developmentMode) log.warn("$message (permitted in development only)") else error(message)
            LogTeamsMessenger()
        }
        "botframework" -> {
            val tenantId = config.property("teams.tenantId").getString()
            val appId = config.property("teams.appId").getString()
            val appSecret = config.property("teams.appSecret").getString()
            if (tenantId.isBlank() || appId.isBlank() || appSecret.isBlank()) {
                error(
                    "teams.transport=botframework requires non-blank tenantId, appId and appSecret " +
                        "(TEAMS_TENANT_ID / TEAMS_APP_ID / TEAMS_APP_SECRET).",
                )
            }
            if (!developmentMode) {
                val mismatched = buildList {
                    if (normalizeUrl(serviceUrl) != normalizeUrl(PRODUCTION_SERVICE_URL)) add("teams.serviceUrl")
                    if (normalizeUrl(loginBaseUrl) != normalizeUrl(PRODUCTION_LOGIN_BASE_URL)) add("teams.loginBaseUrl")
                    if (normalizeUrl(graphBaseUrl) != normalizeUrl(PRODUCTION_GRAPH_BASE_URL)) add("teams.graphBaseUrl")
                }
                if (mismatched.isNotEmpty()) {
                    error(
                        "In production, ${mismatched.joinToString(", ")} must equal the Microsoft default " +
                            "exactly — teams.appSecret is posted to teams.loginBaseUrl on every token " +
                            "request, so an overridden URL there would exfiltrate the secret. These " +
                            "overrides exist only for the local Teams stub, in development.",
                    )
                }
            }
            BotFrameworkTeamsMessenger(
                tenantId = tenantId,
                appId = appId,
                appSecret = appSecret,
                serviceUrl = serviceUrl,
                loginBaseUrl = loginBaseUrl,
                graphBaseUrl = graphBaseUrl,
                requestTimeoutSeconds = requestTimeoutSeconds,
            )
        }
        else -> error("Unknown teams.transport '$transport' — expected disabled, log, or botframework.")
    }
    log.info("Teams messenger transport: {}", transport)
    // The `connectPooled`/`Database.kt` precedent: release the transport's resources (the JDK
    // HttpClient, for `botframework`) once, when the application stops — a no-op for `disabled`/
    // `log`, whose messenger owns nothing.
    monitor.subscribe(ApplicationStopped) { messenger?.close() }
    attributes.put(TeamsMessengerKey, TeamsMessengerHolder(messenger))
    // Published for notifications/NotificationTeamsSender.kt, wired in configureDatabase — the
    // unreachable-retry window the identity cache stamps on a resolve/send failure.
    attributes.put(TeamsUnreachableRetryHoursKey, unreachableRetryHours)
}

/** The `teams.unreachableRetryHours` bound, read by configureDatabase when it wires
 *  `NotificationTeamsSender` — kept out of [TeamsMessenger] itself, which is a pure transport. */
val TeamsUnreachableRetryHoursKey = AttributeKey<Int>("TeamsUnreachableRetryHours")
