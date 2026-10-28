package ch.nokillswit

import ch.nokillswit.plugins.MAX_CALL_ID_LENGTH
import ch.nokillswit.plugins.isAcceptableCallId
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.server.plugins.callid.callId
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * plugins/Monitoring.kt: a client-supplied `X-Request-Id` becomes the call id only when it is 1..64 URL-safe characters; anything
 * else is ignored (no id), never rejected - the request itself is answered as usual.
 */
class CallIdTest {

    @Test
    fun `the call-id rule keeps UUIDs and trace ids and refuses everything else`() {
        for (ok in listOf("a", "0f8fad5b-d9cb-469f-a165-70867728950e", "4bf92f3577b34da6a3ce929d0e0e4736", "req_1.2-3", "x".repeat(64))) {
            assertTrue(isAcceptableCallId(ok), ok)
        }
        for (bad in listOf("", "x".repeat(MAX_CALL_ID_LENGTH + 1), "has space", "line\nbreak", "tab\t", "quote\"", "semi;colon",
            "slash/", "pct%20", "żółw", "ＡＢＣ", "٣", "a=b")) {
            assertFalse(isAcceptableCallId(bad), bad)
        }
    }

    @Test
    fun `an acceptable header becomes the call id and an unacceptable one is ignored, never an error`() = testApplication {
        configureApp()
        application {
            routing { get("/zz-call-id") { call.respondText(call.callId ?: "<none>") } }
        }
        suspend fun idFor(value: String?): String {
            val response = client.get("/zz-call-id") { if (value != null) header(HttpHeaders.XRequestId, value) }
            assertEquals(200, response.status.value, "a bad X-Request-Id never fails the request: $value")
            return response.bodyAsText()
        }
        assertEquals("0f8fad5b-d9cb-469f-a165-70867728950e", idFor("0f8fad5b-d9cb-469f-a165-70867728950e"))
        assertEquals("<none>", idFor(null))
        assertEquals("<none>", idFor("x".repeat(MAX_CALL_ID_LENGTH + 1)))
        assertEquals("<none>", idFor("forged log line"))
        assertEquals("<none>", idFor("%0d%0aINFO fake"))
    }
}
