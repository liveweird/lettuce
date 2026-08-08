package ch.nokillswit

import ch.nokillswit.pulse.PulseCycleResponse
import ch.nokillswit.pulse.PulseMyResponse
import ch.nokillswit.pulse.PulseResponseSubmitRequest
import ch.nokillswit.pulse.PulseScaleAnswer
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The my-response pair: upsert-while-open semantics, the participant/OPEN gates (incl. the
 * anti-copy-paste block once closed), and the payload validation matrix. No other endpoint
 * ever serves individual answers — pinned structurally by the results/comments shapes in
 * PulseResultsTest.
 */
class PulseResponseTest {

    private val cyclesUrl = "/api/v1/pulse-surveys/cycles"

    private fun answers(
        enps: Int,
        q2: PulseScaleAnswer = PulseScaleAnswer.AGREE,
        comment: String? = null,
    ) = PulseResponseSubmitRequest(
        enps = enps,
        q2 = q2,
        q3 = PulseScaleAnswer.NEITHER,
        q4 = PulseScaleAnswer.STRONGLY_AGREE,
        q5 = PulseScaleAnswer.NOT_APPLICABLE,
        rotating = PulseScaleAnswer.DISAGREE,
        comment = comment,
    )

    private suspend fun HttpClient.submit(cycleId: UInt, body: PulseResponseSubmitRequest) =
        put("$cyclesUrl/$cycleId/my-response") {
            contentType(ContentType.Application.Json)
            setBody(body)
        }

    @Test
    fun `upsert roundtrip - first submit, edit while open, blocked once closed`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val userEmail = uniqueEmail("pulse-resp")
        TestUsers.seed(userEmail, "pw", roles = emptySet())
        val user = authedClient(userEmail, "pw")

        val cycle = admin.post(cyclesUrl) {
            contentType(ContentType.Application.Json)
            setBody(ch.nokillswit.pulse.PulseCycleCreateRequest("2099-01-01", "2099-01-08"))
        }.body<PulseCycleResponse>()
        try {
            // While SCHEDULED nobody is a participant yet (the snapshot happens at open).
            assertEquals(HttpStatusCode.Forbidden, user.submit(cycle.id, answers(8)).status)
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/open").status)

            // Nothing saved yet.
            assertEquals(HttpStatusCode.NotFound, user.get("$cyclesUrl/${cycle.id}/my-response").status)

            // First submit, read back (the ONLY per-user read, and only one's own).
            assertEquals(HttpStatusCode.NoContent, user.submit(cycle.id, answers(8, comment = "  keep this  ")).status)
            val first = user.get("$cyclesUrl/${cycle.id}/my-response").body<PulseMyResponse>()
            assertEquals(8, first.enps)
            assertEquals(PulseScaleAnswer.NOT_APPLICABLE, first.q5)
            // The comment is stored trimmed.
            assertEquals("keep this", first.comment)

            // Edit = full replace; submittedAt is the FIRST submission, immutable.
            assertEquals(HttpStatusCode.NoContent, user.submit(cycle.id, answers(2, q2 = PulseScaleAnswer.DISAGREE)).status)
            val edited = user.get("$cyclesUrl/${cycle.id}/my-response").body<PulseMyResponse>()
            assertEquals(2, edited.enps)
            assertEquals(PulseScaleAnswer.DISAGREE, edited.q2)
            assertNull(edited.comment)
            assertEquals(first.submittedAt, edited.submittedAt)
            assertTrue(edited.lastModified >= first.lastModified)

            // Closed: neither read nor write — no copy-paste seed for the next cycle.
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/close").status)
            assertEquals(HttpStatusCode.Conflict, user.get("$cyclesUrl/${cycle.id}/my-response").status)
            assertEquals(HttpStatusCode.Conflict, user.submit(cycle.id, answers(9)).status)
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `a user who joined after the open is not a participant`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val cycle = admin.post(cyclesUrl) {
            contentType(ContentType.Application.Json)
            setBody(ch.nokillswit.pulse.PulseCycleCreateRequest("2099-01-01", "2099-01-08"))
        }.body<PulseCycleResponse>()
        try {
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/open").status)
            val lateEmail = uniqueEmail("pulse-late")
            TestUsers.seed(lateEmail, "pw", roles = emptySet())
            val late = authedClient(lateEmail, "pw")
            assertEquals(HttpStatusCode.Forbidden, late.submit(cycle.id, answers(5)).status)
            assertEquals(HttpStatusCode.Forbidden, late.get("$cyclesUrl/${cycle.id}/my-response").status)
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `payload validation - enps bounds, comment cap, junk scale values`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val userEmail = uniqueEmail("pulse-valid")
        TestUsers.seed(userEmail, "pw", roles = emptySet())
        val user = authedClient(userEmail, "pw")
        val cycle = admin.post(cyclesUrl) {
            contentType(ContentType.Application.Json)
            setBody(ch.nokillswit.pulse.PulseCycleCreateRequest("2099-01-01", "2099-01-08"))
        }.body<PulseCycleResponse>()
        try {
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/open").status)

            assertEquals(HttpStatusCode.BadRequest, user.submit(cycle.id, answers(11)).status)
            assertEquals(HttpStatusCode.BadRequest, user.submit(cycle.id, answers(-1)).status)
            assertEquals(
                HttpStatusCode.BadRequest,
                user.submit(cycle.id, answers(5, comment = "x".repeat(1001))).status,
            )
            // An unknown scale value dies in enum decoding -> 400.
            val junk = user.put("$cyclesUrl/${cycle.id}/my-response") {
                contentType(ContentType.Application.Json)
                setBody("""{"enps":5,"q2":"7","q3":"3","q4":"3","q5":"3","rotating":"3"}""")
            }
            assertEquals(HttpStatusCode.BadRequest, junk.status)

            // A blank comment normalizes to absent.
            assertEquals(HttpStatusCode.NoContent, user.submit(cycle.id, answers(5, comment = "   ")).status)
            assertNull(user.get("$cyclesUrl/${cycle.id}/my-response").body<PulseMyResponse>().comment)
            // Exactly 1000 characters passes.
            assertEquals(
                HttpStatusCode.NoContent,
                user.submit(cycle.id, answers(5, comment = "y".repeat(1000))).status,
            )
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }
}
