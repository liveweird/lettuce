package ch.nokillswit

import ch.nokillswit.infra.teams.BotFrameworkTeamsMessenger
import ch.nokillswit.infra.teams.ConversationResult
import ch.nokillswit.infra.teams.ResolveResult
import ch.nokillswit.infra.teams.SendResult
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Collections
import java.util.concurrent.Executors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private const val TENANT_ID = "tenant-1"
private const val APP_ID = "app-1"
private const val APP_SECRET = "super-secret-value-xyz"

/**
 * Contract test for `infra/teams/TeamsMessenger.kt`'s [BotFrameworkTeamsMessenger] against an
 * in-process fake standing in for login/Graph/the Bot Framework connector (`com.sun.net.httpserver.
 * HttpServer` on port 0) — there is no Teams test tenant (see the plan). Asserts the EXACT
 * documented request shapes (method, path, form fields, the bearer header, JSON bodies) rather
 * than just the parsed [ResolveResult]/[ConversationResult]/[SendResult], since a shape drift here
 * would only ever be caught against a real tenant otherwise.
 */
class BotFrameworkTeamsMessengerTest {

    private data class RecordedRequest(
        val method: String,
        val path: String,
        val query: String?,
        val authorization: String?,
        val contentType: String?,
        val body: String,
    )

    /** A minimal, single-context fake server: every request is recorded and routed through
     *  [respond], which tests reassign per scenario. */
    private class FakeServer {
        val requests = Collections.synchronizedList(mutableListOf<RecordedRequest>())
        var respond: (RecordedRequest) -> Pair<Int, String> = { 200 to "{}" }

        /** Only consulted for a 429 response — lets a test attach a `Retry-After` header without
         *  widening [respond]'s signature everywhere else. */
        var retryAfterHeaderSeconds: (RecordedRequest) -> Int? = { null }

        /** Only consulted for a 3xx response — lets a test attach a `Location` header (the
         *  redirect-not-followed test) without widening [respond]'s signature everywhere else. */
        var locationHeader: (RecordedRequest) -> String? = { null }
        private val server = HttpServer.create(InetSocketAddress(0), 0)
        val port: Int get() = server.address.port

        init {
            server.createContext("/") { exchange: HttpExchange ->
                val body = exchange.requestBody.readBytes().toString(StandardCharsets.UTF_8)
                val recorded = RecordedRequest(
                    method = exchange.requestMethod,
                    // rawPath, not path: an encoded segment like %2F (a literal slash inside a
                    // path component, see the sendMessage conversation-id test) must NOT be
                    // percent-decoded back into a real '/' before routing/assertions see it.
                    path = exchange.requestURI.rawPath,
                    query = exchange.requestURI.rawQuery,
                    authorization = exchange.requestHeaders.getFirst("Authorization"),
                    contentType = exchange.requestHeaders.getFirst("Content-Type"),
                    body = body,
                )
                requests += recorded
                val (status, responseBody) = respond(recorded)
                if (status == 429) {
                    retryAfterHeaderSeconds(recorded)?.let { exchange.responseHeaders.add("Retry-After", it.toString()) }
                }
                if (status in 300..399) {
                    locationHeader(recorded)?.let { exchange.responseHeaders.add("Location", it) }
                }
                val bytes = responseBody.toByteArray(StandardCharsets.UTF_8)
                exchange.responseHeaders.add("Content-Type", "application/json")
                exchange.sendResponseHeaders(status, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
            server.executor = Executors.newCachedThreadPool()
        }

        fun start() = server.start()
        fun stop() = server.stop(0)
    }

    private fun messenger(server: FakeServer, requestTimeoutSeconds: Int = 5) = BotFrameworkTeamsMessenger(
        tenantId = TENANT_ID,
        appId = APP_ID,
        appSecret = APP_SECRET,
        serviceUrl = "http://localhost:${server.port}/teams/",
        loginBaseUrl = "http://localhost:${server.port}",
        graphBaseUrl = "http://localhost:${server.port}/graph",
        requestTimeoutSeconds = requestTimeoutSeconds,
    )

    private fun tokenResponse(accessToken: String = "fake-access-token", expiresIn: Long = 3600): Pair<Int, String> =
        200 to """{"token_type":"Bearer","expires_in":$expiresIn,"access_token":"$accessToken"}"""

    private fun withServer(block: suspend (FakeServer) -> Unit) {
        val server = FakeServer()
        server.start()
        try {
            runBlocking { block(server) }
        } finally {
            server.stop()
        }
    }

    private fun isTokenRequest(r: RecordedRequest) = r.path == "/$TENANT_ID/oauth2/v2.0/token"

    // ---- resolveUser (Graph) --------------------------------------------------------------------

    @Test
    fun `resolveUser - direct lookup hits the documented path and query with a bearer token`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path == "/graph/v1.0/users/pat%40example.com" -> 200 to """{"id":"aad-pat"}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).resolveUser("pat@example.com")
        assertEquals(ResolveResult.Resolved("aad-pat"), result)

        val graphRequest = server.requests.single { it.path.startsWith("/graph/") }
        assertEquals("GET", graphRequest.method)
        assertEquals("/graph/v1.0/users/pat%40example.com", graphRequest.path)
        assertEquals("\$select=id", graphRequest.query)
        assertEquals("Bearer fake-access-token", graphRequest.authorization)

        val tokenRequest = server.requests.single { isTokenRequest(it) }
        assertEquals("POST", tokenRequest.method)
        assertEquals("application/x-www-form-urlencoded", tokenRequest.contentType)
        assertTrue("grant_type=client_credentials" in tokenRequest.body)
        assertTrue("client_id=$APP_ID" in tokenRequest.body)
        assertTrue("client_secret=$APP_SECRET" in tokenRequest.body)
        // resolveUser talks to Graph, so the minted token must carry the Graph scope, not the
        // connector's — the two scopes are cached independently (per-scope token cache).
        assertTrue("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default" in tokenRequest.body)
    }

    @Test
    fun `resolveUser - a mail filter matching several directory objects is unreachable, never guessed`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path == "/graph/v1.0/users/pat%40example.com" -> 404 to """{"error":{"code":"Request_ResourceNotFound"}}"""
                r.path == "/graph/v1.0/users" -> 200 to """{"value":[{"id":"aad-member"},{"id":"aad-guest"}]}"""
                else -> 500 to "{}"
            }
        }
        assertEquals(ResolveResult.Unreachable("ambiguous"), messenger(server).resolveUser("pat@example.com"))
    }

    @Test
    fun `resolveUser - a 404 on the direct lookup falls back to the mail filter`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path == "/graph/v1.0/users/pat%40example.com" -> 404 to """{"error":{"code":"Request_ResourceNotFound"}}"""
                r.path == "/graph/v1.0/users" -> 200 to """{"value":[{"id":"aad-pat-via-filter"}]}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).resolveUser("pat@example.com")
        assertEquals(ResolveResult.Resolved("aad-pat-via-filter"), result)

        val filterRequest = server.requests.single { it.path == "/graph/v1.0/users" }
        assertEquals("GET", filterRequest.method)
        val decodedQuery = URLDecoder.decode(filterRequest.query, StandardCharsets.UTF_8)
        assertTrue("\$filter=mail eq 'pat@example.com'" in decodedQuery, "unexpected query: $decodedQuery")
        assertTrue("\$select=id" in decodedQuery)
        // RFC 3986, not form encoding: a space is %20 on the wire, never "+".
        assertTrue("mail%20eq%20" in filterRequest.query.orEmpty(), "raw query: ${filterRequest.query}")
    }

    @Test
    fun `resolveUser - an empty filter result is Unreachable(user_not_found)`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path == "/graph/v1.0/users/nobody%40example.com" -> 404 to "{}"
                r.path == "/graph/v1.0/users" -> 200 to """{"value":[]}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).resolveUser("nobody@example.com")
        assertEquals(ResolveResult.Unreachable("user_not_found"), result)
    }

    @Test
    fun `resolveUser - a quote in the email is escaped in the filter`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path.startsWith("/graph/v1.0/users/") && !r.path.contains("?") -> 404 to "{}"
                r.path == "/graph/v1.0/users" -> 200 to """{"value":[{"id":"aad-quoted"}]}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).resolveUser("o'brien@example.com")
        assertEquals(ResolveResult.Resolved("aad-quoted"), result)
        val filterRequest = server.requests.single { it.path == "/graph/v1.0/users" }
        val decodedQuery = URLDecoder.decode(filterRequest.query, StandardCharsets.UTF_8)
        assertTrue("mail eq 'o''brien@example.com'" in decodedQuery, "unexpected query: $decodedQuery")
    }

    // ---- token caching / refresh -----------------------------------------------------------------

    @Test
    fun `the token is cached - one token call backs two resolveUser calls`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse(expiresIn = 3600)
                r.path.startsWith("/graph/v1.0/users/") -> 200 to """{"id":"aad-${r.path.substringAfterLast('/')}"}"""
                else -> 500 to "{}"
            }
        }
        val messenger = messenger(server)
        messenger.resolveUser("a@example.com")
        messenger.resolveUser("b@example.com")
        assertEquals(1, server.requests.count { isTokenRequest(it) }, "the cached token must back both calls")
    }

    @Test
    fun `a near-expiry token is refetched on the next call (the 5-minute refresh margin)`() = withServer { server ->
        server.respond = { r ->
            when {
                // Well inside the 5-minute refresh margin, so the SECOND call must not reuse it.
                isTokenRequest(r) -> tokenResponse(expiresIn = 60)
                r.path.startsWith("/graph/v1.0/users/") -> 200 to """{"id":"aad-x"}"""
                else -> 500 to "{}"
            }
        }
        val messenger = messenger(server)
        messenger.resolveUser("a@example.com")
        messenger.resolveUser("b@example.com")
        assertEquals(2, server.requests.count { isTokenRequest(it) }, "a token this close to expiry must be refetched")
    }

    @Test
    fun `a 401 invalidates the cached token and retries once`() = withServer { server ->
        var tokenCalls = 0
        var graphCalls = 0
        server.respond = { r ->
            when {
                isTokenRequest(r) -> {
                    tokenCalls++
                    tokenResponse(accessToken = "token-$tokenCalls")
                }
                r.path.startsWith("/graph/v1.0/users/") -> {
                    graphCalls++
                    if (graphCalls == 1) 401 to "{}" else 200 to """{"id":"aad-after-retry"}"""
                }
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).resolveUser("a@example.com")
        assertEquals(ResolveResult.Resolved("aad-after-retry"), result)
        assertEquals(2, tokenCalls, "a 401 must invalidate the cached token and fetch a fresh one")
        assertEquals(2, graphCalls)
        val graphRequests = server.requests.filter { it.path.startsWith("/graph/v1.0/users/") }
        assertEquals("Bearer token-1", graphRequests[0].authorization)
        assertEquals("Bearer token-2", graphRequests[1].authorization)
    }

    // ---- ensureConversation --------------------------------------------------------------------

    @Test
    fun `ensureConversation posts the documented body and returns the connector's id`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path == "/teams/v3/conversations" -> 200 to """{"id":"conversation-42"}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).ensureConversation("aad-object-id")
        assertEquals(ConversationResult.Created("conversation-42"), result)

        val request = server.requests.single { it.path == "/teams/v3/conversations" }
        assertEquals("POST", request.method)
        assertEquals("Bearer fake-access-token", request.authorization)
        val json = Json.parseToJsonElement(request.body).jsonObject
        assertEquals(APP_ID, json["bot"]!!.jsonObject["id"]!!.jsonPrimitive.content)
        val members = json["members"]!!.jsonArray
        assertEquals("aad-object-id", members[0].jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals(TENANT_ID, json["channelData"]!!.jsonObject["tenant"]!!.jsonObject["id"]!!.jsonPrimitive.content)
    }

    @Test
    fun `ensureConversation - 403 ForbiddenOperationException maps to Unreachable(not_installed)`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path == "/teams/v3/conversations" ->
                    403 to """{"error":{"code":"ForbiddenOperationException","message":"the bot isn't installed"}}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).ensureConversation("aad-object-id")
        assertEquals(ConversationResult.Unreachable("not_installed"), result)
    }

    @Test
    fun `ensureConversation - 403 MessageWritesBlocked maps to Unreachable(blocked)`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path == "/teams/v3/conversations" ->
                    403 to """{"error":{"code":"MessageWritesBlocked","message":"the user blocked the bot"}}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).ensureConversation("aad-object-id")
        assertEquals(ConversationResult.Unreachable("blocked"), result)
    }

    // ---- sendMessage ----------------------------------------------------------------------------

    @Test
    fun `sendMessage posts the documented activity body to the url-encoded conversation path`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path == "/teams/v3/conversations/conv%2F1/activities" -> 200 to """{"id":"activity-1"}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).sendMessage("conv/1", "Hello, \"world\"\nsecond line")
        assertEquals(SendResult.Sent, result)

        val request = server.requests.single { it.path == "/teams/v3/conversations/conv%2F1/activities" }
        assertEquals("POST", request.method)
        val json = Json.parseToJsonElement(request.body).jsonObject
        assertEquals("message", json["type"]!!.jsonPrimitive.content)
        // Load-bearing, not cosmetic: Bot Framework defaults to markdown, and `text` carries
        // other users' display names — a name like "[Reset password](https://evil)" would
        // otherwise render as a clickable link in the recipient's DM without this.
        assertEquals("plain", json["textFormat"]!!.jsonPrimitive.content)
        assertEquals("Hello, \"world\"\nsecond line", json["text"]!!.jsonPrimitive.content)
    }

    @Test
    fun `sendMessage - a 404 maps to ConversationNotFound`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path.startsWith("/teams/v3/conversations/") -> 404 to """{"error":{"code":"NotFound"}}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).sendMessage("gone-conversation", "hi")
        assertEquals(SendResult.ConversationNotFound, result)
    }

    @Test
    fun `sendMessage - 429 honours Retry-After and retries exactly once`() = withServer { server ->
        var attempt = 0
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path.startsWith("/teams/v3/conversations/") -> {
                    attempt++
                    if (attempt == 1) 429 to "{}" else 200 to """{"id":"activity-2"}"""
                }
                else -> 500 to "{}"
            }
        }
        // A short Retry-After (0s) keeps the test fast while still exercising the header-reading
        // path, not just the "no header" default.
        server.retryAfterHeaderSeconds = { if (it.path.startsWith("/teams/v3/conversations/")) 0 else null }
        val result = messenger(server).sendMessage("conv-1", "hi")
        assertEquals(SendResult.Sent, result)
        assertEquals(2, attempt, "exactly one retry after the 429")
    }

    @Test
    fun `sendMessage - 403 ForbiddenOperationException maps to Unreachable(not_installed)`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path.startsWith("/teams/v3/conversations/") ->
                    403 to """{"error":{"code":"ForbiddenOperationException"}}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).sendMessage("conv-1", "hi")
        assertEquals(SendResult.Unreachable("not_installed"), result)
    }

    @Test
    fun `sendMessage - 403 MessageWritesBlocked maps to Unreachable(blocked)`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path.startsWith("/teams/v3/conversations/") ->
                    403 to """{"error":{"code":"MessageWritesBlocked"}}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).sendMessage("conv-1", "hi")
        assertEquals(SendResult.Unreachable("blocked"), result)
    }

    @Test
    fun `sendMessage - a server-side timeout maps to Failed`() {
        val server = FakeServer()
        server.respond = { r ->
            if (isTokenRequest(r)) {
                tokenResponse()
            } else {
                Thread.sleep(2000)
                200 to """{"id":"too-late"}"""
            }
        }
        server.start()
        try {
            runBlocking {
                val result = messenger(server, requestTimeoutSeconds = 1).sendMessage("conv-1", "hi")
                assertEquals(SendResult.Failed, result)
            }
        } finally {
            server.stop()
        }
    }

    // ---- no secret leakage -------------------------------------------------------------------

    @Test
    fun `the client secret and the bearer token never appear in the logs`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse(accessToken = "top-secret-bearer-token")
                r.path == "/graph/v1.0/users/a%40example.com" -> 200 to """{"id":"aad-x"}"""
                // An unexpected status — this IS a logged WARN, so the assertions below have
                // something real to check rather than passing vacuously on an empty log.
                r.path == "/graph/v1.0/users/broken%40example.com" -> 500 to "{}"
                r.path == "/teams/v3/conversations" -> 200 to """{"id":"conv-1"}"""
                r.path.startsWith("/teams/v3/conversations/") -> 403 to """{"error":{"code":"MessageWritesBlocked"}}"""
                else -> 500 to "{}"
            }
        }
        val log = LogCapture("ch.nokillswit.teams")
        try {
            val messenger = messenger(server)
            messenger.resolveUser("a@example.com")
            messenger.ensureConversation("aad-x")
            messenger.sendMessage("conv-1", "hi")
            val failed = messenger.resolveUser("broken@example.com")
            assertEquals(ResolveResult.Failed, failed)
            assertTrue(log.events.isNotEmpty(), "the 500 above should have produced at least one WARN")
            val allMessages = log.events.joinToString("\n") { it.formattedMessage }
            assertFalse(APP_SECRET in allMessages, "the client secret must never be logged")
            assertFalse("top-secret-bearer-token" in allMessages, "the bearer token must never be logged")
        } finally {
            log.detach()
        }
    }

    // ---- URL normalization (checkup review, v4.5.0) ----------------------------------------------

    @Test
    fun `a trailing slash on loginBaseUrl and graphBaseUrl does not double up the joined path`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path == "/graph/v1.0/users/pat%40example.com" -> 200 to """{"id":"aad-pat"}"""
                else -> 500 to "{}"
            }
        }
        val trailingSlashMessenger = BotFrameworkTeamsMessenger(
            tenantId = TENANT_ID,
            appId = APP_ID,
            appSecret = APP_SECRET,
            serviceUrl = "http://localhost:${server.port}/teams/",
            // Both carry a trailing slash — unnormalized, these would join into a doubled `//`.
            loginBaseUrl = "http://localhost:${server.port}/",
            graphBaseUrl = "http://localhost:${server.port}/graph/",
            requestTimeoutSeconds = 5,
        )
        val result = trailingSlashMessenger.resolveUser("pat@example.com")
        assertEquals(ResolveResult.Resolved("aad-pat"), result)

        val tokenRequest = server.requests.single { isTokenRequest(it) }
        assertEquals("/$TENANT_ID/oauth2/v2.0/token", tokenRequest.path, "no doubled slash before the tenant segment")
        val graphRequest = server.requests.single { it.path.startsWith("/graph/") }
        assertEquals("/graph/v1.0/users/pat%40example.com", graphRequest.path, "no doubled slash after /graph")
    }

    // ---- bounded response bodies (checkup review, v4.5.0) ------------------------------------

    @Test
    fun `an oversized response body maps to Failed rather than being buffered in full`() = withServer { server ->
        // Comfortably over the transport's 64 KiB cap.
        val oversized = "x".repeat(200 * 1024)
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path.startsWith("/graph/v1.0/users/") -> 200 to """{"id":"$oversized"}"""
                else -> 500 to "{}"
            }
        }
        val result = messenger(server).resolveUser("big@example.com")
        assertEquals(ResolveResult.Failed, result)
    }

    // ---- redirects are never followed (checkup review, v4.5.0) -------------------------------

    @Test
    fun `a 307 redirect from the token endpoint is not followed and the call Fails`() = withServer { server ->
        server.respond = { r ->
            when {
                isTokenRequest(r) -> 307 to "{}"
                r.path == "/should-never-be-requested" -> 200 to """{"id":"aad-should-not-happen"}"""
                r.path.startsWith("/graph/v1.0/users/") -> 500 to "{}"
                else -> 500 to "{}"
            }
        }
        server.locationHeader = { r -> if (isTokenRequest(r)) "http://localhost:${server.port}/should-never-be-requested" else null }
        val result = messenger(server).resolveUser("a@example.com")
        assertEquals(ResolveResult.Failed, result)
        assertTrue(
            server.requests.none { it.path == "/should-never-be-requested" },
            "the JDK HttpClient defaults to Redirect.NEVER — a redirect target must never be requested",
        )
    }

    // ---- no response-body leakage in logs (checkup review, v4.5.0) ---------------------------

    @Test
    fun `a 500 response body's content never appears in a captured log line`() = withServer { server ->
        val marker = "TOTALLY-SECRET-MARKER-STRING-12345"
        server.respond = { r ->
            when {
                isTokenRequest(r) -> tokenResponse()
                r.path.startsWith("/graph/v1.0/users/") -> 500 to """{"error":{"message":"$marker"}}"""
                else -> 500 to "{}"
            }
        }
        val log = LogCapture("ch.nokillswit.teams")
        try {
            val result = messenger(server).resolveUser("a@example.com")
            assertEquals(ResolveResult.Failed, result)
            val allMessages = log.events.joinToString("\n") { it.formattedMessage }
            assertFalse(marker in allMessages, "the response body must never be logged, even on failure")
        } finally {
            log.detach()
        }
    }

    @Test
    fun `a cancelled coroutine propagates CancellationException rather than a Failed result`() = withServer { server ->
        server.respond = { r -> if (isTokenRequest(r)) tokenResponse() else { Thread.sleep(2000); 200 to "{}" } }
        var cancellationSeen = false
        coroutineScope {
            val job = launch {
                try {
                    messenger(server, requestTimeoutSeconds = 30).resolveUser("a@example.com")
                } catch (e: CancellationException) {
                    cancellationSeen = true
                    throw e
                }
            }
            delay(200)
            job.cancelAndJoin()
        }
        assertTrue(cancellationSeen, "cancellation must propagate out of the transport, never become Failed")
    }
}
