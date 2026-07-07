package ch.nokillswit

import ch.nokillswit.feedbacks.FeedbackContentUpdate
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackPageResponse
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Self-reflection: a feedback whose provider IS the subject (and never a requester). Exercises
 * the relaxed validate() invariant, the untouched provider-centric authz/lifecycle, the manager
 * read path, and the suppression of self-notifications.
 */
class SelfReflectionTest {

    private suspend fun ApplicationTestBuilder.selfUser(): Triple<String, UInt, HttpClient> {
        val email = uniqueEmail("selfie")
        val id = TestUsers.seed(email = email, password = "pw", role = UserRole.USER)
        return Triple(email, id, authedClient(email, "pw"))
    }

    private suspend fun HttpClient.createSelf(
        userId: UInt,
        status: FeedbackStatus = FeedbackStatus.DRAFT,
        visibility: FeedbackVisibility = FeedbackVisibility.PROVIDER_SUBJECT,
    ): FeedbackResponse {
        val response = post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = userId,
                    providerId = userId,
                    visibility = visibility,
                    status = status,
                    content = "Note to self",
                )
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<FeedbackResponse>()
    }

    @Test
    fun `full provider lifecycle - create draft, edit, send, withdraw`() = testApplication {
        usePostgresTestcontainer()
        val (_, userId, client) = selfUser()

        val created = client.createSelf(userId)
        assertEquals(userId, created.providerId)
        assertEquals(userId, created.subjectId)

        // The provider always reads their own record, even as DRAFT.
        val read = client.get("/api/v1/feedbacks/${created.id}")
        assertEquals(HttpStatusCode.OK, read.status)
        assertEquals("Note to self", read.body<FeedbackResponse>().content)

        val edited = client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(FeedbackContentUpdate(content = "Sharper note", visibility = FeedbackVisibility.PROVIDER_SUBJECT))
        }
        assertEquals(HttpStatusCode.NoContent, edited.status)

        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/feedbacks/${created.id}/send").status)
        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/feedbacks/${created.id}/withdraw").status)
        assertEquals(
            FeedbackStatus.WITHDRAWN,
            client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>().status,
        )
    }

    @Test
    fun `a self-reflection with a requester is rejected`() = testApplication {
        usePostgresTestcontainer()
        val (_, userId, client) = selfUser()
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw", role = UserRole.USER)

        val response = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = requesterId,
                    subjectId = userId,
                    providerId = userId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.REQUESTED,
                    content = "",
                )
            )
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `self transitions mint no notifications`() = testApplication {
        usePostgresTestcontainer()
        val (_, userId, client) = selfUser()

        val created = client.createSelf(userId)
        client.post("/api/v1/feedbacks/${created.id}/send")
        client.post("/api/v1/feedbacks/${created.id}/withdraw")

        // The user is freshly seeded, so any notification here would come from the self actions.
        val notifications = client.get("/api/v1/notifications").body<NotificationPageResponse>()
        assertEquals(0, notifications.total)
    }

    @Test
    fun `a manager sees a delivered self-reflection but not a draft`() = testApplication {
        usePostgresTestcontainer()
        val (_, userId, client) = selfUser()
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw", role = UserRole.USER)
        val teamId = TestServices.teams.create(Team(name = "self-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, userId)
        val managerClient = authedClient(managerEmail, "pw")

        val created = client.createSelf(userId)
        // DRAFT: private to the provider — the management chain is delivered-only.
        assertEquals(HttpStatusCode.Forbidden, managerClient.get("/api/v1/feedbacks/${created.id}").status)

        client.post("/api/v1/feedbacks/${created.id}/send")
        assertEquals(HttpStatusCode.OK, managerClient.get("/api/v1/feedbacks/${created.id}").status)
        val team = managerClient.get("/api/v1/feedbacks?view=team").body<FeedbackPageResponse>()
        assertTrue(team.items.any { it.id == created.id })
    }

    @Test
    fun `a third party reads a self-reflection only when public and sent`() = testApplication {
        usePostgresTestcontainer()
        val (_, userId, client) = selfUser()
        val otherEmail = uniqueEmail("bystander")
        TestUsers.seed(email = otherEmail, password = "pw", role = UserRole.USER)
        val otherClient = authedClient(otherEmail, "pw")

        val private = client.createSelf(userId, status = FeedbackStatus.SENT)
        assertEquals(HttpStatusCode.Forbidden, otherClient.get("/api/v1/feedbacks/${private.id}").status)

        val public = client.createSelf(userId, status = FeedbackStatus.SENT, visibility = FeedbackVisibility.PUBLIC)
        assertEquals(HttpStatusCode.OK, otherClient.get("/api/v1/feedbacks/${public.id}").status)
    }
}
