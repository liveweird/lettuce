package ch.nokillswit.infra.teams

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.HttpTimeoutException
import java.nio.charset.StandardCharsets
import java.time.Duration

/**
 * Sends a Microsoft Teams direct message to one Lettuce user, in three steps that mirror the two
 * Microsoft Learn pages cited throughout this file (send-proactive-messages,
 * bot-framework-rest-connector-authentication — single-tenant tab): resolve the recipient's Entra
 * object id from their email ([resolveUser]), get-or-create the 1:1 conversation with the bot
 * ([ensureConversation]), then post the activity ([sendMessage]). Deliberately three narrow calls
 * rather than one wide `send` — the identity/conversation CACHE lives one layer up
 * (`notifications/NotificationTeamsSender.kt`, a DB table, not infra), so infra/teams stays a pure
 * transport with no persistence and every step is independently retryable/cacheable by the caller
 * (e.g. a stale cached conversation id that 404s is dropped and [ensureConversation] is called
 * again, without re-resolving the user).
 */
interface TeamsMessenger {
    suspend fun resolveUser(email: String): ResolveResult
    suspend fun ensureConversation(aadObjectId: String): ConversationResult
    suspend fun sendMessage(conversationId: String, text: String): SendResult

    /** Releases the transport's resources (e.g. the JDK [HttpClient]) — called once from
     *  `ApplicationStopped`. A no-op default for transports (like [LogTeamsMessenger]) that own
     *  nothing to release. */
    fun close() {}
}

/** Outcome of [TeamsMessenger.resolveUser]. */
sealed interface ResolveResult {
    data class Resolved(val aadObjectId: String) : ResolveResult

    /** A durable "don't retry every send" outcome — `user_not_found` only today. */
    data class Unreachable(val reason: String) : ResolveResult
    data object Failed : ResolveResult
}

/** Outcome of [TeamsMessenger.ensureConversation]. */
sealed interface ConversationResult {
    data class Created(val conversationId: String) : ConversationResult

    /** `not_installed` (403 ForbiddenOperationException) or `blocked` (403 MessageWritesBlocked). */
    data class Unreachable(val reason: String) : ConversationResult
    data object Failed : ConversationResult
}

/** Outcome of [TeamsMessenger.sendMessage]. */
sealed interface SendResult {
    data object Sent : SendResult

    /** The cached conversation id no longer exists server-side (404) — the caller should drop it
     *  and retry once via [TeamsMessenger.ensureConversation] + [TeamsMessenger.sendMessage]. */
    data object ConversationNotFound : SendResult
    data class Unreachable(val reason: String) : SendResult
    data object Failed : SendResult
}

/**
 * Development transport: writes every call to the `ch.nokillswit.teams` logger instead of
 * calling out to Microsoft (the `infra/mail/Mailer.kt` LogMailer idiom). Never logs anything that
 * would be secret in a real deployment — there is nothing secret to log here, since no
 * credentials are involved in the log-only path.
 */
class LogTeamsMessenger : TeamsMessenger {
    private val log = LoggerFactory.getLogger("ch.nokillswit.teams")

    override suspend fun resolveUser(email: String): ResolveResult {
        log.info("Teams resolveUser (log transport, not sent)")
        return ResolveResult.Resolved(aadObjectId = "log-${email.hashCode()}")
    }

    override suspend fun ensureConversation(aadObjectId: String): ConversationResult {
        log.info("Teams ensureConversation (log transport, not sent)")
        return ConversationResult.Created(conversationId = "log-conversation-$aadObjectId")
    }

    override suspend fun sendMessage(conversationId: String, text: String): SendResult {
        log.info("Outbound Teams message (log transport, not sent)\n\n{}", text)
        return SendResult.Sent
    }
}

/**
 * The real transport: JDK [HttpClient] only (no new Gradle dependency) plus kotlinx.serialization
 * for the small JSON bodies. A failed request is logged at most as step/status/subCode on the
 * `ch.nokillswit.teams` logger — never the client secret, a bearer token, or a response body,
 * which could carry tenant/user details Lettuce has no business persisting in logs. Response
 * bodies are additionally bounded at [MAX_RESPONSE_BODY_BYTES] so a malicious/misbehaving peer
 * cannot make this transport buffer an unbounded reply.
 *
 * References (cited per the fields/flows they justify below):
 *  - https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages
 *  - https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
 *    (single-tenant tab)
 */
class BotFrameworkTeamsMessenger(
    private val tenantId: String,
    private val appId: String,
    private val appSecret: String,
    serviceUrl: String,
    loginBaseUrl: String,
    graphBaseUrl: String,
    requestTimeoutSeconds: Int,
    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(CONNECT_TIMEOUT_SECONDS))
        .build(),
) : TeamsMessenger {
    // "The default service URL is https://smba.trafficmanager.net/teams/" — POSTs below always
    // join a path onto this with no leading slash, so a caller-supplied trailing slash (or its
    // absence) must not double up or drop the separator.
    private val serviceUrl = serviceUrl.trimEnd('/') + "/"

    // Normalized the same way (trim + trailing slash dropped) as configureTeams' production-pin
    // comparison, but for a different reason: these two are joined with a LEADING '/' below
    // (`"$loginBaseUrl/$tenantId/..."`, `"$graphBaseUrl/v1.0/..."`), so an operator-supplied
    // trailing slash would otherwise double up into `https://login.microsoftonline.com//tenant`.
    private val loginBaseUrl = loginBaseUrl.trim().trimEnd('/')
    private val graphBaseUrl = graphBaseUrl.trim().trimEnd('/')
    private val requestTimeout = Duration.ofSeconds(requestTimeoutSeconds.toLong())
    private val log = LoggerFactory.getLogger("ch.nokillswit.teams")
    private val json = Json { ignoreUnknownKeys = true }

    private companion object {
        const val CONNECT_TIMEOUT_SECONDS = 5L
        const val CONNECTOR_SCOPE = "https://api.botframework.com/.default"
        const val GRAPH_SCOPE = "https://graph.microsoft.com/.default"

        // Refresh a cached token this long before it actually expires, so a request never races
        // an about-to-expire token.
        const val TOKEN_REFRESH_MARGIN_MILLIS = 5 * 60 * 1000L
        const val MAX_RETRY_AFTER_SECONDS = 10L

        // A malicious/misbehaving peer (or a very verbose error page) must never make this
        // transport buffer an unbounded response — capped well above any real Bot
        // Framework/Graph payload this code parses.
        const val MAX_RESPONSE_BODY_BYTES = 64 * 1024

        // The only Bot Framework `error.code` values this transport recognizes and reacts to
        // (see [connectorUnreachable]/[sendMessage]) — safe to name in a log line, unlike the
        // rest of a response body.
        val KNOWN_SUB_CODES = listOf("ForbiddenOperationException", "MessageWritesBlocked")
    }

    /** A bounded stand-in for [HttpResponse]`<String>` — see [send]. */
    private data class TeamsResponse(val statusCode: Int, val body: String, val retryAfterSeconds: Long?)

    /** Thrown by [send] when a response body exceeds [MAX_RESPONSE_BODY_BYTES] — caught by
     *  [runCatchingIo] like any other transport failure, so callers see a plain [SendResult]/
     *  [ResolveResult]/[ConversationResult] `Failed`, never an oversized buffer. */
    private class TeamsResponseTooLargeException :
        RuntimeException("Teams response body exceeded $MAX_RESPONSE_BODY_BYTES bytes")

    private data class CachedToken(val accessToken: String, val expiresAtEpochMillis: Long)

    private val tokenMutex = Mutex()
    private val tokenCache = mutableMapOf<String, CachedToken>()

    @Serializable
    private data class TokenResponse(
        @SerialName("access_token") val accessToken: String,
        @SerialName("expires_in") val expiresIn: Long,
    )

    @Serializable
    private data class GraphUser(val id: String)

    @Serializable
    private data class GraphUserList(val value: List<GraphUser> = emptyList())

    @Serializable
    private data class ConversationResponse(val id: String)

    /** Releases the JDK [HttpClient]'s resources — [HttpClient] is [AutoCloseable] since JDK 21. */
    override fun close() {
        httpClient.close()
    }

    // ---- resolveUser (Graph) ----------------------------------------------------------------

    override suspend fun resolveUser(email: String): ResolveResult = runCatchingIo({ ResolveResult.Failed }) {
        val encodedPathEmail = URLEncoder.encode(email, StandardCharsets.UTF_8).replace("+", "%20")
        val direct = get("$graphBaseUrl/v1.0/users/$encodedPathEmail?\$select=id", GRAPH_SCOPE)
        if (direct.statusCode == 200) {
            return@runCatchingIo ResolveResult.Resolved(json.decodeFromString(GraphUser.serializer(), direct.body).id)
        }
        if (direct.statusCode != 404) {
            logRequestFailure("graph_lookup", direct)
            return@runCatchingIo ResolveResult.Failed
        }
        // Sending by email/UPN is not supported — the 404 fallback filters by mail instead (the
        // email may not be the user's primary Graph "userPrincipalName").
        val escaped = email.replace("'", "''")
        // RFC 3986 query encoding (%20, never the form-encoding "+", which OData may not decode as a space).
        val filter = URLEncoder.encode("mail eq '$escaped'", StandardCharsets.UTF_8).replace("+", "%20")
        val filtered = get("$graphBaseUrl/v1.0/users?\$filter=$filter&\$select=id", GRAPH_SCOPE)
        if (filtered.statusCode != 200) {
            logRequestFailure("graph_filter", filtered)
            return@runCatchingIo ResolveResult.Failed
        }
        val matches = json.decodeFromString(GraphUserList.serializer(), filtered.body).value
        when {
            matches.isEmpty() -> ResolveResult.Unreachable("user_not_found")
            // Sending by email is a fallback for exactly this reason — `mail` is not guaranteed
            // unique across a tenant's directory; more than one hit means Lettuce cannot safely
            // pick a recipient, so this durably skips the send rather than guessing.
            matches.size > 1 -> {
                log.warn("Teams Graph mail filter matched {} users, expected exactly one", matches.size)
                ResolveResult.Unreachable("ambiguous")
            }
            else -> ResolveResult.Resolved(matches.single().id)
        }
    }

    // ---- ensureConversation (Bot Framework connector) ----------------------------------------

    override suspend fun ensureConversation(aadObjectId: String): ConversationResult =
        runCatchingIo({ ConversationResult.Failed }) {
            val body = """{"bot":{"id":${jsonString(appId)}},"members":[{"id":${jsonString(aadObjectId)}}],""" +
                """"channelData":{"tenant":{"id":${jsonString(tenantId)}}}}"""
            val response = post("${serviceUrl}v3/conversations", CONNECTOR_SCOPE, body)
            connectorUnreachable(response)?.let { return@runCatchingIo it }
            if (response.statusCode !in 200..299) {
                logRequestFailure("conversation", response)
                return@runCatchingIo ConversationResult.Failed
            }
            ConversationResult.Created(json.decodeFromString(ConversationResponse.serializer(), response.body).id)
        }

    private fun connectorUnreachable(response: TeamsResponse): ConversationResult.Unreachable? {
        if (response.statusCode != 403) return null
        return when (recognizedSubCode(response.body)) {
            "ForbiddenOperationException" -> ConversationResult.Unreachable("not_installed")
            "MessageWritesBlocked" -> ConversationResult.Unreachable("blocked")
            else -> null
        }
    }

    // ---- sendMessage (Bot Framework connector) -------------------------------------------------

    override suspend fun sendMessage(conversationId: String, text: String): SendResult =
        runCatchingIo({ SendResult.Failed }) {
            val encodedConversationId = URLEncoder.encode(conversationId, StandardCharsets.UTF_8).replace("+", "%20")
            // textFormat "plain" is load-bearing, not cosmetic: Bot Framework defaults to
            // markdown, and `text` carries other users' display names (see the class doc on
            // NotificationTeamsSender) — a name like "[Reset password](https://evil)" would
            // otherwise render as a clickable link in the recipient's DM.
            val body = """{"type":"message","textFormat":"plain","text":${jsonString(text)}}"""
            val response = post("${serviceUrl}v3/conversations/$encodedConversationId/activities", CONNECTOR_SCOPE, body)
            if (response.statusCode in 200..299) return@runCatchingIo SendResult.Sent
            if (response.statusCode == 404) return@runCatchingIo SendResult.ConversationNotFound
            if (response.statusCode == 403) {
                when (recognizedSubCode(response.body)) {
                    "ForbiddenOperationException" -> return@runCatchingIo SendResult.Unreachable("not_installed")
                    "MessageWritesBlocked" -> return@runCatchingIo SendResult.Unreachable("blocked")
                }
            }
            logRequestFailure("send", response)
            SendResult.Failed
        }

    // ---- shared HTTP plumbing ------------------------------------------------------------------

    /** GET with a bearer token for [scope], one 401-triggered token-refresh retry and one
     *  429-triggered Retry-After retry (capped at [MAX_RETRY_AFTER_SECONDS]). */
    private suspend fun get(url: String, scope: String): TeamsResponse =
        withAuthRetry(scope) { token ->
            send(
                HttpRequest.newBuilder(URI.create(url))
                    .timeout(requestTimeout)
                    .header("Authorization", "Bearer $token")
                    .GET()
                    .build(),
            )
        }

    private suspend fun post(url: String, scope: String, body: String): TeamsResponse =
        withAuthRetry(scope) { token ->
            send(
                HttpRequest.newBuilder(URI.create(url))
                    .timeout(requestTimeout)
                    .header("Authorization", "Bearer $token")
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                    .build(),
            )
        }

    /** Sends [makeRequest] with a fresh/cached token; on 401 invalidates the cached token for
     *  [scope] and retries exactly once; on 429 honours `Retry-After` (capped) and retries once. */
    private suspend fun withAuthRetry(
        scope: String,
        makeRequest: suspend (token: String) -> TeamsResponse,
    ): TeamsResponse {
        val token = tokenFor(scope)
        val first = makeRequest(token)
        if (first.statusCode == 401) {
            invalidateToken(scope)
            return makeRequest(tokenFor(scope))
        }
        if (first.statusCode == 429) {
            val retryAfterSeconds = (first.retryAfterSeconds ?: 0L).coerceIn(0L, MAX_RETRY_AFTER_SECONDS)
            delay(retryAfterSeconds * 1000)
            return makeRequest(tokenFor(scope))
        }
        return first
    }

    /**
     * Reads the response body through [BodyHandlers.ofInputStream] rather than `ofString` and
     * caps it at [MAX_RESPONSE_BODY_BYTES] + 1 bytes ([InputStream.readNBytes] never reads more
     * than asked) — an oversized body throws [TeamsResponseTooLargeException] instead of letting
     * this transport buffer an attacker- or outage-sized response in full. Still blocking (the
     * JDK [HttpClient] has no coroutine-native async surface without a new dependency — see the
     * class doc), so it stays on [Dispatchers.IO].
     */
    private suspend fun send(request: HttpRequest): TeamsResponse = withContext(Dispatchers.IO) {
        val response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream())
        val bytes = response.body().use { it.readNBytes(MAX_RESPONSE_BODY_BYTES + 1) }
        if (bytes.size > MAX_RESPONSE_BODY_BYTES) throw TeamsResponseTooLargeException()
        val retryAfterSeconds = response.headers().firstValue("Retry-After").map { it.toLongOrNull() }.orElse(null)
        TeamsResponse(response.statusCode(), String(bytes, StandardCharsets.UTF_8), retryAfterSeconds)
    }

    private suspend fun tokenFor(scope: String): String = tokenMutex.withLock {
        val now = System.currentTimeMillis()
        val cached = tokenCache[scope]
        if (cached != null && cached.expiresAtEpochMillis - now > TOKEN_REFRESH_MARGIN_MILLIS) {
            return@withLock cached.accessToken
        }
        val fresh = requestToken(scope)
        tokenCache[scope] = fresh
        fresh.accessToken
    }

    private suspend fun invalidateToken(scope: String) {
        tokenMutex.withLock { tokenCache.remove(scope) }
    }

    /**
     * `POST {loginBaseUrl}/{tenantId}/oauth2/v2.0/token`, client-credentials grant — the
     * bot-framework-rest-connector-authentication single-tenant flow. Never logs [appSecret] or
     * the minted token; only the scope and outcome.
     */
    private suspend fun requestToken(scope: String): CachedToken {
        val form = listOf(
            "grant_type" to "client_credentials",
            "client_id" to appId,
            "client_secret" to appSecret,
            "scope" to scope,
        ).joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, StandardCharsets.UTF_8)}" }
        val request = HttpRequest.newBuilder(URI.create("$loginBaseUrl/$tenantId/oauth2/v2.0/token"))
            .timeout(requestTimeout)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(form, StandardCharsets.UTF_8))
            .build()
        val response = send(request)
        if (response.statusCode !in 200..299) {
            logRequestFailure("token", response)
            error("Teams token request failed, status ${response.statusCode}")
        }
        val parsed = json.decodeFromString(TokenResponse.serializer(), response.body)
        return CachedToken(parsed.accessToken, System.currentTimeMillis() + parsed.expiresIn * 1000)
    }

    /** Minimal JSON string-literal encoder for the hand-built request bodies above (produces a
     *  quoted, escaped literal, e.g. `"a \"b\""`) — the values are ids/appId/tenantId/notification
     *  text, never attacker-controlled markup, but party names DO ride the text (see
     *  NotificationTeamsSender), so quotes/control chars must escape. */
    private fun jsonString(value: String): String = json.encodeToString(value)

    /** The subset of Bot Framework `error.code` values this transport reacts to — never returns
     *  an arbitrary substring of [body], so a log line built from this never leaks response text. */
    private fun recognizedSubCode(body: String): String? = KNOWN_SUB_CODES.firstOrNull { it in body }

    /** One WARN per failed step, naming the step, the HTTP status, and — only when it is one of
     *  [KNOWN_SUB_CODES] — the Teams `error.code`. Never logs the response body itself. */
    private fun logRequestFailure(step: String, response: TeamsResponse) {
        val subCode = recognizedSubCode(response.body)
        if (subCode != null) {
            log.warn("Teams request failed (step={}, status={}, subCode={})", step, response.statusCode, subCode)
        } else {
            log.warn("Teams request failed (step={}, status={})", step, response.statusCode)
        }
    }

    /**
     * Cancellation-safe (rethrows [CancellationException] untouched, the `infra.catchingFailures`
     * idiom): every other failure — a timeout, a connection error, a malformed response — becomes
     * [onFailure]'s value rather than an exception escaping this transport, so a caller never has
     * to catch anything from a [TeamsMessenger] call.
     */
    private suspend fun <T> runCatchingIo(onFailure: () -> T, block: suspend () -> T): T =
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: HttpTimeoutException) {
            log.warn("Teams request timed out: {}", e.message)
            onFailure()
        } catch (e: Exception) {
            log.warn("Teams request failed: {}", e.javaClass.simpleName)
            onFailure()
        }
}
