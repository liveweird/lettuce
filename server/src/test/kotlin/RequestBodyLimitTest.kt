package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.plugins.sanitizeForLog
import ch.nokillswit.templates.Template
import ch.nokillswit.templates.TemplatePageResponse
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.ktor.utils.io.ByteReadChannel
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.zip.GZIPOutputStream
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * The request-body size cap (v4.14.1, plugins/BodyLimit.kt): a declared Content-Length over the
 * cap is refused before routing, a chunked/undeclared body is cut off while streaming, both as a
 * `413` problem+json; the CSV import has its own larger cap; compressed request bodies are never
 * inflated. The raw wire shapes (a real Netty engine) live in RawRequestBodyLimitTest.
 * `jsonClient()`/`authedClient()` carry the OpenAPI conformance plugin, so the 413 body is
 * validated against the declared `PayloadTooLarge` response.
 */
class RequestBodyLimitTest {

    private val problemJson = ContentType.parse("application/problem+json")

    private fun ApplicationTestBuilder.smallCaps() =
        configureApp("http.maxBodyBytes" to "2048")

    private suspend fun ApplicationTestBuilder.adminClient(): HttpClient {
        val email = uniqueEmail("bodylimit-admin")
        TestUsers.seed(email, "pw-123456789")
        return authedClient(email, "pw-123456789")
    }

    /** A valid [Template] JSON padded with trailing spaces (still valid JSON) to exactly [bytes] bytes. */
    private fun templateJson(name: String, bytes: Int): String {
        val json = Json.encodeToString(Template(name = name, content = "body"))
        require(json.length <= bytes)
        return json + " ".repeat(bytes - json.length)
    }

    private suspend fun HttpClient.postTemplate(body: String, token: Boolean = true): HttpResponse =
        post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            if (!token) header(HttpHeaders.Authorization, "Bearer not-a-token")
            setBody(body)
        }

    private suspend fun HttpResponse.assertTooLarge(limit: Long) {
        assertEquals(HttpStatusCode.PayloadTooLarge, status)
        assertEquals(problemJson, contentType()?.withoutParameters())
        val problem = body<ProblemDetail>()
        assertEquals(413, problem.status)
        assertEquals("Request body must not exceed $limit bytes", problem.detail)
    }

    @Test
    fun `a declared Content-Length over the cap is a 413 problem and nothing is created`() = testApplication {
        smallCaps()
        startApplication()
        val client = adminClient()
        val name = "bodylimit-${UUID.randomUUID()}"

        client.postTemplate(templateJson(name, 3 * 1024)).assertTooLarge(2048)

        val listed = client.get("/api/v1/templates?name=$name").body<TemplatePageResponse>()
        assertEquals(0, listed.items.size, "the oversized body must never reach the route")
    }

    @Test
    fun `a body exactly at the cap passes and one byte over is refused`() = testApplication {
        smallCaps()
        startApplication()
        val client = adminClient()

        val atCap = client.postTemplate(templateJson("bodylimit-${UUID.randomUUID()}", 2048))
        assertEquals(HttpStatusCode.Created, atCap.status)

        client.postTemplate(templateJson("bodylimit-${UUID.randomUUID()}", 2049)).assertTooLarge(2048)
    }

    @Test
    fun `the cap runs before authentication - an oversized body is a 413 even without a valid token`() =
        testApplication {
            smallCaps()
            startApplication()
            val anonymous = jsonClient()
            anonymous.postTemplate(templateJson("bodylimit-anon", 3 * 1024), token = false).assertTooLarge(2048)
            // The same request under the cap proves the 401 is what the cap pre-empted.
            val small = anonymous.postTemplate(templateJson("bodylimit-anon", 512), token = false)
            assertEquals(HttpStatusCode.Unauthorized, small.status)
        }

    @Test
    fun `a chunked body without Content-Length is cut off while streaming and the handler never runs`() =
        testApplication {
            smallCaps()
            startApplication()
            val client = jsonClient()
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                val email = uniqueEmail("bodylimit-chunked")
                val login = Json.encodeToString(LoginRequest(email, "pw")).padEnd(3 * 1024, ' ')
                val response = client.post("/api/v1/login") {
                    contentType(ContentType.Application.Json)
                    // A ByteReadChannel body carries no Content-Length, so only the streaming cap can stop it.
                    setBody(ByteReadChannel(login.toByteArray()))
                }
                response.assertTooLarge(2048)
                assertTrue(
                    audit.events.none { it.message.startsWith("login.") },
                    "the login handler must not run: ${audit.describeEvents()}",
                )
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `a chunked body under the cap passes through the counting wrapper untouched`() = testApplication {
        smallCaps()
        startApplication()
        val client = jsonClient()
        val email = uniqueEmail("bodylimit-ok")
        TestUsers.seed(email, "pw-123456789", roles = emptySet())
        val login = Json.encodeToString(LoginRequest(email, "pw-123456789")).padEnd(1024, ' ')
        val response = client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(ByteReadChannel(login.toByteArray()))
        }
        assertEquals(HttpStatusCode.OK, response.status)
    }

    @Test
    fun `the default cap is wired from application yaml - four MiB plus one chunked byte is refused`() =
        testApplication {
            usePostgresTestcontainer()
            val client = jsonClient()
            val login = Json.encodeToString(LoginRequest(uniqueEmail("bodylimit-default"), "pw"))
                .padEnd(4 * 1024 * 1024 + 1, ' ')
            val response = client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(ByteReadChannel(login.toByteArray()))
            }
            response.assertTooLarge(4_194_304)
        }

    @Test
    fun `the default cap admits the contract-valid worst case - a 1 to 1 with three full lists of 3-byte chars`() =
        testApplication {
            usePostgresTestcontainer()
            val client = adminClient()
            // 100 items x 4000 chars is the declared maximum per list (MAX_ONE_ON_ONE_*); the euro
            // sign is 3 UTF-8 bytes, where realistic text tops out per char. (JSON-escaped control
            // characters could be larger, but are not realistic content.)
            val content = "€".repeat(4000)
            fun items(extra: String) = (1..100).joinToString(",", "[", "]") { """{"content":"$content"$extra}""" }
            val body = """{"subordinateId":1,"meetingDate":"2026-01-01","points":${items("")},""" +
                """"decisions":${items("")},"actionItems":${items(""","owner":"MANAGER"""")}}"""
            val size = body.toByteArray().size
            assertTrue(size > 3_500_000 && size < 4_194_304, "worst-case body is $size bytes")
            val response = client.post("/api/v1/one-on-ones") {
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            // Whatever the route makes of it (400/403/404/201), it must not be the size cap.
            assertTrue(response.status != HttpStatusCode.PayloadTooLarge, "got ${response.status}")
        }

    @Test
    fun `a 413 under api carries exactly one no-store Cache-Control and closes the connection`() = testApplication {
        smallCaps()
        startApplication()
        val response = jsonClient().postTemplate(templateJson("bodylimit-cc", 3 * 1024), token = false)
        response.assertTooLarge(2048)
        assertEquals(listOf("no-store"), response.headers.getAll(HttpHeaders.CacheControl))
        assertEquals(listOf("close"), response.headers.getAll(HttpHeaders.Connection))
    }

    @Test
    fun `sanitizeForLog replaces control and non-ASCII chars and caps the length`() {
        assertEquals("/api/v1/x??Y?", sanitizeForLog("/api/v1/x\u001b\u007fY\n"))
        assertEquals("/a?b?", sanitizeForLog("/aéb€"))
        val long = sanitizeForLog("/" + "a".repeat(500))
        assertEquals(200 + 3, long.length)
        assertTrue(long.endsWith("..."))
    }

    @Test
    fun `a gzip request body is never inflated - it is malformed JSON, not a bomb`() = testApplication {
        configureApp("http.maxBodyBytes" to "65536")
        startApplication()
        val client = jsonClient()

        fun gzip(write: (GZIPOutputStream) -> Unit): ByteArray {
            val out = ByteArrayOutputStream()
            GZIPOutputStream(out).use(write)
            return out.toByteArray()
        }

        suspend fun post(bytes: ByteArray) = client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.ContentEncoding, "gzip")
            setBody(bytes)
        }

        val valid = gzip { it.write(Json.encodeToString(LoginRequest("a@b.c", "pw")).toByteArray()) }
        val validResponse = post(valid)
        assertEquals(HttpStatusCode.BadRequest, validResponse.status)
        assertEquals(
            "Request body is invalid or does not match the expected schema",
            validResponse.body<ProblemDetail>().detail,
        )

        // ~20 MiB of zeros compresses to a few KiB — under the cap on the wire, a bomb if inflated.
        val bomb = gzip { out ->
            val zeros = ByteArray(1024 * 1024)
            repeat(20) { out.write(zeros) }
        }
        assertTrue(bomb.size < 65536, "the bomb must fit under the wire cap (${bomb.size} bytes)")
        val bombResponse = post(bomb)
        assertEquals(HttpStatusCode.BadRequest, bombResponse.status)
        assertEquals(
            "Request body is invalid or does not match the expected schema",
            bombResponse.body<ProblemDetail>().detail,
        )
    }
}
