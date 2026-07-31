package ch.nokillswit

import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.plugins.ProblemDetail
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The no-duplicate invariant: creation is 409 while an active DRAFT or REQUESTED feedback with
 * the same (subject, provider, requester) triple exists (null requester matches only null); the
 * ProblemDetail `instance` points at the existing record. Pick-up is guarded the same way, and
 * `GET /api/v1/feedbacks/duplicate-check` backs the SPA's early warning.
 */
class FeedbackDuplicateTest {

    @Serializable
    private data class DuplicateCheck(val existingId: UInt?, val existingStatus: FeedbackStatus?)

    private data class Triad(
        val providerEmail: String,
        val providerId: UInt,
        val subjectId: UInt,
        val requesterEmail: String,
        val requesterId: UInt,
    )

    private suspend fun seedTriad(): Triad {
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(providerEmail, "pw", name = "Pat Provider", roles = emptySet())
        val subjectId = TestUsers.seed(uniqueEmail("subject"), "pw", name = "Sam Subject", roles = emptySet())
        val requesterEmail = uniqueEmail("requester")
        val requesterId = TestUsers.seed(requesterEmail, "pw", name = "Rita Requester", roles = emptySet())
        return Triad(providerEmail, providerId, subjectId, requesterEmail, requesterId)
    }

    private suspend fun HttpClient.createFeedback(
        subjectId: UInt,
        providerId: UInt,
        requesterId: UInt? = null,
        status: FeedbackStatus = FeedbackStatus.DRAFT,
        visibility: FeedbackVisibility =
            if (requesterId == null) FeedbackVisibility.PROVIDER_SUBJECT
            else FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
    ): HttpResponse = post("/api/v1/feedbacks") {
        contentType(ContentType.Application.Json)
        setBody(
            FeedbackCreateRequest(
                requesterId = requesterId,
                subjectId = subjectId,
                providerId = providerId,
                visibility = visibility,
                status = status,
                content = "some content",
            ),
        )
    }

    @Test
    fun `an active draft blocks creating any second feedback with the same triple`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val provider = authedClient(t.providerEmail, "pw")
        val existing = provider.createFeedback(t.subjectId, t.providerId).body<FeedbackResponse>()

        // Every creation entry point is blocked: draft, save & send — with the existing record's
        // API path in the ProblemDetail instance.
        for (status in listOf(FeedbackStatus.DRAFT, FeedbackStatus.SENT)) {
            val response = provider.createFeedback(t.subjectId, t.providerId, status = status)
            assertEquals(HttpStatusCode.Conflict, response.status, "create as $status must conflict")
            val problem = response.body<ProblemDetail>()
            assertEquals("/api/v1/feedbacks/${existing.id}", problem.instance)
        }
    }

    @Test
    fun `an active request blocks a duplicate ask and a matching draft creation`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val requester = authedClient(t.requesterEmail, "pw")
        val existing = requester
            .createFeedback(t.subjectId, t.providerId, requesterId = t.requesterId, status = FeedbackStatus.REQUESTED)
            .body<FeedbackResponse>()

        // Asking again with the identical triple is a duplicate…
        val again = requester
            .createFeedback(t.subjectId, t.providerId, requesterId = t.requesterId, status = FeedbackStatus.REQUESTED)
        assertEquals(HttpStatusCode.Conflict, again.status)
        assertEquals("/api/v1/feedbacks/${existing.id}", again.body<ProblemDetail>().instance)

        // …and so is the provider starting a draft carrying the same triple.
        val provider = authedClient(t.providerEmail, "pw")
        val draft = provider.createFeedback(
            t.subjectId, t.providerId, requesterId = t.requesterId, status = FeedbackStatus.DRAFT,
        )
        assertEquals(HttpStatusCode.Conflict, draft.status)
    }

    @Test
    fun `a different triple or a closed status does not block`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val other = TestUsers.seed(uniqueEmail("other"), "pw", name = "Olga Other", roles = emptySet())
        val provider = authedClient(t.providerEmail, "pw")
        // The existing no-requester DRAFT.
        val existingDraft = provider.createFeedback(t.subjectId, t.providerId).body<FeedbackResponse>()

        // Requester set vs null is a different triple — allowed both ways.
        val requester = authedClient(t.requesterEmail, "pw")
        assertEquals(
            HttpStatusCode.Created,
            requester.createFeedback(
                t.subjectId, t.providerId, requesterId = t.requesterId, status = FeedbackStatus.REQUESTED,
            ).status,
        )
        // Different subject — allowed.
        assertEquals(HttpStatusCode.Created, provider.createFeedback(other, t.providerId).status)

        // Delivered/terminal rows never block: send the original draft, then a new one is fine.
        assertEquals(HttpStatusCode.NoContent, provider.post("/api/v1/feedbacks/${existingDraft.id}/send").status)
        assertEquals(HttpStatusCode.Created, provider.createFeedback(t.subjectId, t.providerId).status)
    }

    @Test
    fun `a soft-deleted draft does not block`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val provider = authedClient(t.providerEmail, "pw")
        val existing = provider.createFeedback(t.subjectId, t.providerId).body<FeedbackResponse>()
        assertEquals(HttpStatusCode.NoContent, provider.delete("/api/v1/feedbacks/${existing.id}").status)

        assertEquals(HttpStatusCode.Created, provider.createFeedback(t.subjectId, t.providerId).status)
    }

    @Test
    fun `picking up a request is 409 while a matching draft exists`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        // Seed the pre-constraint duplicate pair directly through the service (bypasses the
        // create-time check): a REQUESTED row and a DRAFT with the identical triple.
        val requested = TestServices.feedbacks.create(
            Feedback(
                requesterId = t.requesterId, subjectId = t.subjectId, providerId = t.providerId,
                visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                status = FeedbackStatus.REQUESTED, content = "",
            ),
        ).id
        // The service's create() now refuses duplicates, so insert the legacy DRAFT raw (the
        // cipher tolerates non-enveloped legacy plaintext on read).
        val draft = suspendTransaction(TestServices.feedbacks.database) {
            FeedbackService.Feedbacks.insert {
                it[requesterId] = t.requesterId
                it[subjectId] = t.subjectId
                it[providerId] = t.providerId
                it[visibility] = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT
                it[status] = FeedbackStatus.DRAFT
                it[content] = "legacy duplicate"
                it[lastModified] = System.currentTimeMillis()
            }[FeedbackService.Feedbacks.id].value
        }

        val provider = authedClient(t.providerEmail, "pw")
        val pickUp = provider.post("/api/v1/feedbacks/$requested/pick-up")
        assertEquals(HttpStatusCode.Conflict, pickUp.status)
        assertEquals("/api/v1/feedbacks/$draft", pickUp.body<ProblemDetail>().instance)
    }

    @Test
    fun `duplicate-check reports the existing feedback to a party and rejects others`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val provider = authedClient(t.providerEmail, "pw")

        // Nothing yet: nulls.
        val clean = provider
            .get("/api/v1/feedbacks/duplicate-check?subjectId=${t.subjectId}&providerId=${t.providerId}")
            .body<DuplicateCheck>()
        assertNull(clean.existingId)
        assertNull(clean.existingStatus)

        val existing = provider.createFeedback(t.subjectId, t.providerId).body<FeedbackResponse>()
        val found = provider
            .get("/api/v1/feedbacks/duplicate-check?subjectId=${t.subjectId}&providerId=${t.providerId}")
            .body<DuplicateCheck>()
        assertEquals(existing.id, found.existingId)
        assertEquals(FeedbackStatus.DRAFT, found.existingStatus)

        // The triple is exact: probing with a requester attached finds nothing.
        val withRequester = provider.get(
            "/api/v1/feedbacks/duplicate-check?subjectId=${t.subjectId}&providerId=${t.providerId}&requesterId=${t.requesterId}",
        ).body<DuplicateCheck>()
        assertNull(withRequester.existingId)

        // Party rule: a caller who is neither the prospective provider nor requester is 403…
        val bystander = authedClient(t.requesterEmail, "pw")
        assertEquals(
            HttpStatusCode.Forbidden,
            bystander.get("/api/v1/feedbacks/duplicate-check?subjectId=${t.subjectId}&providerId=${t.providerId}").status,
        )
        // …but the same caller probing as the prospective requester is allowed.
        assertEquals(
            HttpStatusCode.OK,
            bystander.get(
                "/api/v1/feedbacks/duplicate-check?subjectId=${t.subjectId}&providerId=${t.providerId}&requesterId=${t.requesterId}",
            ).status,
        )
        // Missing params are 400.
        assertEquals(
            HttpStatusCode.BadRequest,
            provider.get("/api/v1/feedbacks/duplicate-check?subjectId=${t.subjectId}").status,
        )
    }
}
