package ch.nokillswit

import ch.nokillswit.reviews.CategoryAssessment
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.reviews.ReviewPeriod
import ch.nokillswit.reviews.ReviewPeriodCreateRequest
import ch.nokillswit.reviews.ReviewPeriodList
import ch.nokillswit.reviews.monthAfter
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The review-period registry: append-only gapless timeline, ADMIN-managed, hard-deleting.
 * The timeline is GLOBAL shared state in the shared container — every test appends after the
 * current latest (via [TestReviewPeriods] or the API relative to the live latest), never
 * hand-picking absolute months.
 */
class ReviewPeriodTest {

    @Test
    fun `the timeline is readable by any authenticated user and ordered oldest first`() = testApplication {
        usePostgresTestcontainer()
        val first = TestReviewPeriods.append()
        val second = TestReviewPeriods.append(months = 3)
        val plainEmail = uniqueEmail("period-reader")
        TestUsers.seed(plainEmail, "pw", roles = emptySet())

        val list = authedClient(plainEmail, "pw")
            .get("/api/v1/review-periods").body<ReviewPeriodList>()
        val ours = list.items.filter { it.id == first.id || it.id == second.id }
        assertEquals(listOf(first, second), ours)
        // Ordered oldest first over the whole timeline (start months are unique).
        assertEquals(list.items.sortedBy { it.startMonth }, list.items)
        // Adjacency held at creation: the second starts the month after the first ends.
        assertEquals(monthAfter(first.endMonth), second.startMonth)
    }

    @Test
    fun `mutations are ADMIN-only and reads require authentication`() = testApplication {
        usePostgresTestcontainer()
        val latest = TestReviewPeriods.append()
        val plainEmail = uniqueEmail("period-plain")
        TestUsers.seed(plainEmail, "pw", roles = emptySet())
        val plain = authedClient(plainEmail, "pw")

        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/review-periods").status)
        assertEquals(
            HttpStatusCode.Forbidden,
            plain.post("/api/v1/review-periods") {
                contentType(ContentType.Application.Json)
                setBody(ReviewPeriodCreateRequest(monthAfter(latest.endMonth), monthAfter(latest.endMonth)))
            }.status,
        )
        assertEquals(HttpStatusCode.Forbidden, plain.delete("/api/v1/review-periods/${latest.id}").status)
    }

    @Test
    fun `create validates the month shape and appends only adjacently`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("period-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val latest = TestReviewPeriods.append()

        suspend fun tryCreate(start: String, end: String) = admin.post("/api/v1/review-periods") {
            contentType(ContentType.Application.Json)
            setBody(ReviewPeriodCreateRequest(start, end))
        }

        // Shape errors are 400.
        assertEquals(HttpStatusCode.BadRequest, tryCreate("2026-1", "2026-06").status)
        assertEquals(HttpStatusCode.BadRequest, tryCreate("garbage", "2026-06").status)
        val next = monthAfter(latest.endMonth)
        assertEquals(
            HttpStatusCode.BadRequest,
            tryCreate(next, monthAfter(latest.startMonth)).status, // start after end
        )
        // Timeline-state errors are 409: a gap, an overlap, and a duplicate start alike.
        assertEquals(HttpStatusCode.Conflict, tryCreate(monthAfter(next), monthAfter(monthAfter(next))).status)
        assertEquals(HttpStatusCode.Conflict, tryCreate(latest.endMonth, monthAfter(next)).status)
        assertEquals(HttpStatusCode.Conflict, tryCreate(latest.startMonth, latest.endMonth).status)

        // The adjacent create succeeds, returns the document, and sets Location.
        val response = tryCreate(next, monthAfter(next))
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<ReviewPeriod>()
        assertEquals("/api/v1/review-periods/${created.id}", response.headers["Location"])
        assertEquals(next, created.startMonth)
    }

    @Test
    fun `only the latest unreferenced period may be deleted`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("period-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")

        val older = TestReviewPeriods.append()
        val latest = TestReviewPeriods.append()

        // Not the latest → 409; unknown id → 404.
        assertEquals(HttpStatusCode.Conflict, admin.delete("/api/v1/review-periods/${older.id}").status)
        assertEquals(HttpStatusCode.NotFound, admin.delete("/api/v1/review-periods/999999").status)

        // Referenced by a review — even a soft-deleted one — → 409.
        val managerEmail = uniqueEmail("period-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("period-sub"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(
            ch.nokillswit.teams.Team(name = "period-${java.util.UUID.randomUUID()}", managerId = managerId),
        )
        TestServices.teams.addMember(teamId, subordinateId)
        val reviewId = TestServices.performanceReviews.create(
            managerId,
            PerformanceReviewCreateRequest(
                subordinateId = subordinateId,
                periodId = latest.id,
                attitude = CategoryAssessment(3, "ok"),
            ),
        )
        assertEquals(HttpStatusCode.Conflict, admin.delete("/api/v1/review-periods/${latest.id}").status)
        TestServices.performanceReviews.delete(reviewId) // soft delete — the FK row remains
        assertEquals(HttpStatusCode.Conflict, admin.delete("/api/v1/review-periods/${latest.id}").status)

        // A fresh unreferenced latest deletes cleanly (hard delete), then the timeline continues.
        val disposable = TestReviewPeriods.append(months = 1)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/review-periods/${disposable.id}").status)
        val list = admin.get("/api/v1/review-periods").body<ReviewPeriodList>()
        assertTrue(list.items.none { it.id == disposable.id })
        // Appending still works — the previous latest is the anchor again.
        assertNotNull(TestReviewPeriods.append(months = 1))
    }

    @Test
    fun `period mutations land in the security audit trail`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("period-audit-admin")
        val adminId = TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val latest = TestReviewPeriods.append()
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            val next = monthAfter(latest.endMonth)
            val created = admin.post("/api/v1/review-periods") {
                contentType(ContentType.Application.Json)
                setBody(ReviewPeriodCreateRequest(next, next))
            }.body<ReviewPeriod>()
            admin.delete("/api/v1/review-periods/${created.id}")

            val createdEvent = capture.awaitEvent {
                it.message == "review_period.created" &&
                    it.keyValuePairs?.any { kv -> kv.key == "periodId" && kv.value == created.id.toLong() } == true
            }
            assertNotNull(createdEvent)
            assertEquals(adminId.toLong(), createdEvent.keyValuePairs.first { it.key == "byUserId" }.value)
            assertTrue(createdEvent.hasKeyValue("startMonth", next))
            assertNotNull(
                capture.awaitEvent {
                    it.message == "review_period.deleted" &&
                        it.keyValuePairs?.any { kv -> kv.key == "periodId" && kv.value == created.id.toLong() } == true
                },
            )
        } finally {
            capture.detach()
        }
    }
}
