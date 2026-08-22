package ch.nokillswit

import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.reviews.CategoryAssessment
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.reviews.PerformanceReviewEventListResponse
import ch.nokillswit.reviews.PerformanceReviewEventType
import ch.nokillswit.reviews.PerformanceReviewPageResponse
import ch.nokillswit.reviews.PerformanceReviewResponse
import ch.nokillswit.reviews.PerformanceReviewStatus
import ch.nokillswit.reviews.PerformanceReviewUpdateRequest
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PerformanceReviewRoutesTest {

    private data class ReviewPair(
        val managerId: UInt,
        val managerEmail: String,
        val subordinateId: UInt,
        val subordinateEmail: String,
    )

    /** A manager with one direct report (a fresh team per call, so tests never interfere). */
    private suspend fun seedPair(): ReviewPair {
        val managerEmail = uniqueEmail("review-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", name = "Mona Manager", roles = emptySet())
        val subordinateEmail = uniqueEmail("review-subordinate")
        val subordinateId = TestUsers.seed(subordinateEmail, "pw", name = "Sub Ordinate", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "review-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        return ReviewPair(managerId, managerEmail, subordinateId, subordinateEmail)
    }

    /** Puts [pair]'s manager into a team managed by a new grand-manager; returns (email, id). */
    private suspend fun seedGrandManager(pair: ReviewPair): Pair<String, UInt> {
        val grandEmail = uniqueEmail("review-grand")
        val grandId = TestUsers.seed(grandEmail, "pw", name = "Grand Manager", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "review-g-${UUID.randomUUID()}", managerId = grandId))
        TestServices.teams.addMember(teamId, pair.managerId)
        return grandEmail to grandId
    }

    private suspend fun HttpClient.createReview(
        subordinateId: UInt,
        periodId: UInt,
        attitude: CategoryAssessment = CategoryAssessment(3, "attitude ok"),
        delivery: CategoryAssessment = CategoryAssessment(4, "delivery ok"),
        skills: CategoryAssessment = CategoryAssessment(5, "skills ok"),
        overall: CategoryAssessment = CategoryAssessment(4, "overall ok"),
    ): PerformanceReviewResponse {
        val response = post("/api/v1/performance-reviews") {
            contentType(ContentType.Application.Json)
            setBody(
                PerformanceReviewCreateRequest(
                    subordinateId = subordinateId,
                    periodId = periodId,
                    attitude = attitude,
                    delivery = delivery,
                    skills = skills,
                    overall = overall,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<PerformanceReviewResponse>()
    }

    // ---- creation ----

    @Test
    fun `create rejects a period that has not started - current month injected, no timeline pollution`() =
        testApplication {
            usePostgresTestcontainer()
            // Service-level with an injected currentMonth (the goals `today` idiom): a genuinely
            // future period would need appending the SHARED gapless timeline past real "now",
            // poisoning every later test's creates — so the clock moves instead of the timeline.
            val period = TestReviewPeriods.append()
            val request = { subordinateId: UInt ->
                PerformanceReviewCreateRequest(subordinateId = subordinateId, periodId = period.id)
            }

            // Both months in the future (now precedes the start) → rejected.
            val pairA = seedPair()
            val beforeStart = java.time.YearMonth.parse(period.startMonth).minusMonths(1).toString()
            assertFailsWith<io.ktor.server.plugins.BadRequestException> {
                TestServices.performanceReviews.create(pairA.managerId, request(pairA.subordinateId), beforeStart)
            }
            // The rejection left nothing behind — the slot is still free.
            val id = TestServices.performanceReviews.create(
                pairA.managerId, request(pairA.subordinateId), period.startMonth,
            )
            assertTrue(id > 0u) // boundary: the period's first month has begun

            // Started but not ended (end month still in the future) → allowed.
            val pairB = seedPair()
            val midPeriod = java.time.YearMonth.parse(period.startMonth).plusMonths(1).toString()
            val id2 = TestServices.performanceReviews.create(
                pairB.managerId, request(pairB.subordinateId), midPeriod,
            )
            assertTrue(id2 > 0u)
        }

    @Test
    fun `create and read round-trip - always DRAFT, manager from the JWT, partial assessments kept`() =
        testApplication {
            usePostgresTestcontainer()
            val pair = seedPair()
            val period = TestReviewPeriods.append()
            val manager = authedClient(pair.managerEmail, "pw")

            val response = manager.post("/api/v1/performance-reviews") {
                contentType(ContentType.Application.Json)
                setBody(
                    PerformanceReviewCreateRequest(
                        subordinateId = pair.subordinateId,
                        periodId = period.id,
                        attitude = CategoryAssessment(rating = 5, summary = "great collaborator"),
                        // delivery/skills/overall deliberately unset — a partial draft is legal.
                    ),
                )
            }
            assertEquals(HttpStatusCode.Created, response.status)
            val created = response.body<PerformanceReviewResponse>()
            assertEquals("/api/v1/performance-reviews/${created.id}", response.headers["Location"])
            assertEquals(PerformanceReviewStatus.DRAFT, created.status)
            assertEquals(pair.managerId, created.managerId)
            assertEquals("Mona Manager", created.managerName)
            assertEquals("Sub Ordinate", created.subordinateName)
            assertEquals(period.id, created.periodId)
            assertEquals(period.startMonth, created.periodStartMonth)
            assertEquals(period.endMonth, created.periodEndMonth)
            assertEquals(CategoryAssessment(5, "great collaborator"), created.attitude)
            assertEquals(CategoryAssessment(null, null), created.delivery)
            assertTrue(created.createdAt > 0)

            val fetched = manager.get("/api/v1/performance-reviews/${created.id}")
                .body<PerformanceReviewResponse>()
            assertEquals(created, fetched)

            // Creation is audited but notifies nobody (a draft is private).
            val events = manager.get("/api/v1/performance-reviews/${created.id}/events")
                .body<PerformanceReviewEventListResponse>()
            assertEquals(listOf(PerformanceReviewEventType.CREATED), events.items.map { it.type })
            val subordinate = authedClient(pair.subordinateEmail, "pw")
            val notifications = subordinate.get("/api/v1/notifications").body<NotificationPageResponse>()
            assertTrue(notifications.items.none { it.type.name.startsWith("PERFORMANCE_REVIEW_") })
        }

    @Test
    fun `create rejects non-direct-reports, create-on-behalf, bad ratings, and unknown periods`() =
        testApplication {
            usePostgresTestcontainer()
            val pair = seedPair()
            val period = TestReviewPeriods.append()
            val outsiderEmail = uniqueEmail("review-outsider")
            TestUsers.seed(outsiderEmail, "pw", roles = emptySet())
            val adminEmail = uniqueEmail("review-admin")
            TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))

            suspend fun HttpClient.tryCreate(
                subordinateId: UInt = pair.subordinateId,
                periodId: UInt = period.id,
                attitude: CategoryAssessment = CategoryAssessment(),
            ) = post("/api/v1/performance-reviews") {
                contentType(ContentType.Application.Json)
                setBody(PerformanceReviewCreateRequest(subordinateId, periodId, attitude = attitude))
            }.status

            // An outsider is not the subordinate's manager; ADMIN gets no create-on-behalf.
            assertEquals(HttpStatusCode.Forbidden, authedClient(outsiderEmail, "pw").tryCreate())
            assertEquals(HttpStatusCode.Forbidden, authedClient(adminEmail, "pw").tryCreate())
            val manager = authedClient(pair.managerEmail, "pw")
            // A nonexistent subordinate is indistinguishable from a non-report (403, not 404).
            assertEquals(HttpStatusCode.Forbidden, manager.tryCreate(subordinateId = 999999u))
            // A nonexistent period fails the FK → 400.
            assertEquals(HttpStatusCode.BadRequest, manager.tryCreate(periodId = 999999u))
            // Ratings outside 1–6 and oversized summaries are 400.
            assertEquals(
                HttpStatusCode.BadRequest,
                manager.tryCreate(attitude = CategoryAssessment(rating = 0)),
            )
            assertEquals(
                HttpStatusCode.BadRequest,
                manager.tryCreate(attitude = CategoryAssessment(rating = 7)),
            )
            assertEquals(
                HttpStatusCode.BadRequest,
                manager.tryCreate(attitude = CategoryAssessment(3, "x".repeat(4001))),
            )
        }

    @Test
    fun `a chain manager creates a review for a skip-level report and stays its author`() =
        testApplication {
            usePostgresTestcontainer()
            // The chain rule (v2.33.0): the grand-manager writes the skip-level report's
            // review — they become the stored manager; the DRAFT stays private to its author
            // (the direct manager, a chain reader, sees post-DRAFT only).
            val pair = seedPair()
            val (grandEmail, grandId) = seedGrandManager(pair)
            val period = TestReviewPeriods.append()
            val grand = authedClient(grandEmail, "pw")

            val created = grand.createReview(pair.subordinateId, period.id)
            assertEquals(grandId, created.managerId)
            assertEquals(HttpStatusCode.OK, grand.get("/api/v1/performance-reviews/${created.id}").status)
            val directManager = authedClient(pair.managerEmail, "pw")
            assertEquals(
                HttpStatusCode.Forbidden,
                directManager.get("/api/v1/performance-reviews/${created.id}").status,
            )
            // Free the shared period slot for later tests (the timeline is append-only).
            assertEquals(
                HttpStatusCode.NoContent,
                grand.delete("/api/v1/performance-reviews/${created.id}").status,
            )
        }

    @Test
    fun `one review per subordinate and period - 409 with the existing review's instance`() =
        testApplication {
            usePostgresTestcontainer()
            val pair = seedPair()
            val period = TestReviewPeriods.append()
            val manager = authedClient(pair.managerEmail, "pw")
            val existing = manager.createReview(pair.subordinateId, period.id)

            // The same manager again → 409, instance pointing at the existing review.
            val duplicate = manager.post("/api/v1/performance-reviews") {
                contentType(ContentType.Application.Json)
                setBody(PerformanceReviewCreateRequest(pair.subordinateId, period.id))
            }
            assertEquals(HttpStatusCode.Conflict, duplicate.status)
            val problem = duplicate.body<ch.nokillswit.plugins.ProblemDetail>()
            assertEquals(HttpStatusCode.Conflict.value, problem.status)
            assertEquals("/api/v1/performance-reviews/${existing.id}", problem.instance)

            // A DIFFERENT manager of the same subordinate hits the same wall — the rule is
            // per (subordinate, period), not per author.
            val secondManagerEmail = uniqueEmail("review-manager2")
            val secondManagerId = TestUsers.seed(secondManagerEmail, "pw", roles = emptySet())
            val teamId = TestServices.teams.create(
                Team(name = "review-2-${UUID.randomUUID()}", managerId = secondManagerId),
            )
            TestServices.teams.addMember(teamId, pair.subordinateId)
            val secondManager = authedClient(secondManagerEmail, "pw")
            assertEquals(
                HttpStatusCode.Conflict,
                secondManager.post("/api/v1/performance-reviews") {
                    contentType(ContentType.Application.Json)
                    setBody(PerformanceReviewCreateRequest(pair.subordinateId, period.id))
                }.status,
            )
            // A CHAIN manager (create right since v2.33.0) hits it too — first writer wins
            // across the whole chain.
            val (grandEmail, _) = seedGrandManager(pair)
            assertEquals(
                HttpStatusCode.Conflict,
                authedClient(grandEmail, "pw").post("/api/v1/performance-reviews") {
                    contentType(ContentType.Application.Json)
                    setBody(PerformanceReviewCreateRequest(pair.subordinateId, period.id))
                }.status,
            )

            // Deleting the draft frees the slot.
            assertEquals(
                HttpStatusCode.NoContent,
                manager.delete("/api/v1/performance-reviews/${existing.id}").status,
            )
            assertEquals(
                HttpStatusCode.Created,
                secondManager.post("/api/v1/performance-reviews") {
                    contentType(ContentType.Application.Json)
                    setBody(PerformanceReviewCreateRequest(pair.subordinateId, period.id))
                }.status,
            )
            // A second period holds its own slot.
            val nextPeriod = TestReviewPeriods.append(months = 1)
            assertEquals(
                HttpStatusCode.Created,
                manager.post("/api/v1/performance-reviews") {
                    contentType(ContentType.Application.Json)
                    setBody(PerformanceReviewCreateRequest(pair.subordinateId, nextPeriod.id))
                }.status,
            )
        }

    // ---- reads ----

    @Test
    fun `read matrix - author always, subordinate PUBLISHED-only, chain from CALIBRATION, HR always, ADMIN never`() =
        testApplication {
            usePostgresTestcontainer()
            val pair = seedPair()
            val period = TestReviewPeriods.append()
            val (grandEmail, _) = seedGrandManager(pair)
            val manager = authedClient(pair.managerEmail, "pw")
            val subordinate = authedClient(pair.subordinateEmail, "pw")
            val grand = authedClient(grandEmail, "pw")
            val hrEmail = uniqueEmail("review-hr")
            TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
            val hr = authedClient(hrEmail, "pw")
            val adminEmail = uniqueEmail("review-admin")
            TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))
            val admin = authedClient(adminEmail, "pw")
            val outsiderEmail = uniqueEmail("review-outsider")
            TestUsers.seed(outsiderEmail, "pw", roles = emptySet())
            val outsider = authedClient(outsiderEmail, "pw")

            val review = manager.createReview(pair.subordinateId, period.id)
            val url = "/api/v1/performance-reviews/${review.id}"

            suspend fun statuses() = listOf(
                manager.get(url).status,
                subordinate.get(url).status,
                grand.get(url).status,
                hr.get(url).status,
                admin.get(url).status,
                outsider.get(url).status,
            )

            // DRAFT: private to the author (+ HR).
            assertEquals(
                listOf(
                    HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden,
                    HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden,
                ),
                statuses(),
            )

            // CALIBRATION: the chain joins; the subordinate still may not see it.
            assertEquals(HttpStatusCode.NoContent, manager.post("$url/submit").status)
            assertEquals(
                listOf(
                    HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.OK,
                    HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden,
                ),
                statuses(),
            )

            // PUBLISHED: the subordinate finally reads it.
            assertEquals(HttpStatusCode.NoContent, manager.post("$url/publish").status)
            assertEquals(
                listOf(
                    HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.OK,
                    HttpStatusCode.OK, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden,
                ),
                statuses(),
            )

            // Missing ids are 404 (existence-only disclosure), and reads need authentication.
            assertEquals(HttpStatusCode.NotFound, manager.get("/api/v1/performance-reviews/999999").status)
            assertEquals(HttpStatusCode.Unauthorized, jsonClient().get(url).status)
        }

    @Test
    fun `an HR read of a draft lands in the audit trail`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val period = TestReviewPeriods.append()
        val manager = authedClient(pair.managerEmail, "pw")
        val review = manager.createReview(pair.subordinateId, period.id)
        val hrEmail = uniqueEmail("review-hr")
        val hrId = TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
        val hr = authedClient(hrEmail, "pw")

        val capture = LogCapture("ch.nokillswit.audit")
        try {
            assertEquals(HttpStatusCode.OK, hr.get("/api/v1/performance-reviews/${review.id}").status)
            val hit = capture.awaitEvent {
                it.message == "hr.read" && it.hasKeyValue("resource", "performanceReview")
            }
            assertNotNull(hit)
            assertEquals(hrId.toLong(), hit.keyValuePairs.first { it.key == "byUserId" }.value)
            assertEquals(review.id.toLong(), hit.keyValuePairs.first { it.key == "resourceId" }.value)
        } finally {
            capture.detach()
        }
    }

    // ---- lifecycle ----

    @Test
    fun `the full cycle - submit, revert, submit, publish, unpublish - and illegal edges are 409`() =
        testApplication {
            usePostgresTestcontainer()
            val pair = seedPair()
            val period = TestReviewPeriods.append()
            val manager = authedClient(pair.managerEmail, "pw")
            val review = manager.createReview(pair.subordinateId, period.id)
            val url = "/api/v1/performance-reviews/${review.id}"

            suspend fun status() = manager.get(url).body<PerformanceReviewResponse>().status

            // From DRAFT only submit is legal.
            assertEquals(HttpStatusCode.Conflict, manager.post("$url/revert").status)
            assertEquals(HttpStatusCode.Conflict, manager.post("$url/publish").status)
            assertEquals(HttpStatusCode.Conflict, manager.post("$url/unpublish").status)
            assertEquals(HttpStatusCode.NoContent, manager.post("$url/submit").status)
            assertEquals(PerformanceReviewStatus.CALIBRATION, status())

            // From CALIBRATION: revert and publish, never submit/unpublish.
            assertEquals(HttpStatusCode.Conflict, manager.post("$url/submit").status)
            assertEquals(HttpStatusCode.Conflict, manager.post("$url/unpublish").status)
            assertEquals(HttpStatusCode.NoContent, manager.post("$url/revert").status)
            assertEquals(PerformanceReviewStatus.DRAFT, status())
            assertEquals(HttpStatusCode.NoContent, manager.post("$url/submit").status)
            assertEquals(HttpStatusCode.NoContent, manager.post("$url/publish").status)
            assertEquals(PerformanceReviewStatus.PUBLISHED, status())

            // From PUBLISHED only unpublish is legal — PUBLISHED is otherwise read-only.
            assertEquals(HttpStatusCode.Conflict, manager.post("$url/submit").status)
            assertEquals(HttpStatusCode.Conflict, manager.post("$url/revert").status)
            assertEquals(HttpStatusCode.Conflict, manager.post("$url/publish").status)
            assertEquals(HttpStatusCode.NoContent, manager.post("$url/unpublish").status)
            assertEquals(PerformanceReviewStatus.CALIBRATION, status())

            // Every transition landed in the audit history, newest first.
            val events = manager.get("$url/events").body<PerformanceReviewEventListResponse>()
            assertEquals(
                listOf("PUBLISHED->CALIBRATION", "CALIBRATION->PUBLISHED", "DRAFT->CALIBRATION",
                    "CALIBRATION->DRAFT", "DRAFT->CALIBRATION"),
                events.items.filter { it.type == PerformanceReviewEventType.STATUS_CHANGED }
                    .map { "${it.params["from"]}->${it.params["to"]}" },
            )
        }

    @Test
    fun `an incomplete draft may not enter calibration`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val period = TestReviewPeriods.append()
        val manager = authedClient(pair.managerEmail, "pw")
        val review = manager.createReview(
            pair.subordinateId, period.id,
            skills = CategoryAssessment(rating = 5, summary = null), // summary missing
        )
        val url = "/api/v1/performance-reviews/${review.id}"

        assertEquals(HttpStatusCode.BadRequest, manager.post("$url/submit").status)
        // A blank summary counts as missing too.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put(url) {
                contentType(ContentType.Application.Json)
                setBody(
                    PerformanceReviewUpdateRequest(
                        attitude = review.attitude, delivery = review.delivery,
                        skills = CategoryAssessment(5, "   "), overall = review.overall,
                    ),
                )
            }.status,
        )
        assertEquals(HttpStatusCode.BadRequest, manager.post("$url/submit").status)
        // Completing the summary unlocks the transition.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put(url) {
                contentType(ContentType.Application.Json)
                setBody(
                    PerformanceReviewUpdateRequest(
                        attitude = review.attitude, delivery = review.delivery,
                        skills = CategoryAssessment(5, "now complete"), overall = review.overall,
                    ),
                )
            }.status,
        )
        assertEquals(HttpStatusCode.NoContent, manager.post("$url/submit").status)
    }

    @Test
    fun `only the manager may transition - not the subordinate, not ADMIN`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val period = TestReviewPeriods.append()
        val manager = authedClient(pair.managerEmail, "pw")
        val review = manager.createReview(pair.subordinateId, period.id)
        val url = "/api/v1/performance-reviews/${review.id}"
        val adminEmail = uniqueEmail("review-admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))

        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(pair.subordinateEmail, "pw").post("$url/submit").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(adminEmail, "pw").post("$url/submit").status,
        )
    }

    // ---- notifications ----

    @Test
    fun `publish notifies the subordinate with a link, unpublish without one, submit and revert silently`() =
        testApplication {
            usePostgresTestcontainer()
            val pair = seedPair()
            val period = TestReviewPeriods.append()
            val manager = authedClient(pair.managerEmail, "pw")
            val subordinate = authedClient(pair.subordinateEmail, "pw")
            val review = manager.createReview(pair.subordinateId, period.id)
            val url = "/api/v1/performance-reviews/${review.id}"

            suspend fun reviewNotifications() = subordinate.get("/api/v1/notifications")
                .body<NotificationPageResponse>()
                .items.filter { it.type.name.startsWith("PERFORMANCE_REVIEW_") }

            manager.post("$url/submit")
            manager.post("$url/revert")
            manager.post("$url/submit")
            assertEquals(emptyList(), reviewNotifications())

            manager.post("$url/publish")
            val published = reviewNotifications().single()
            assertEquals(NotificationType.PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE, published.type)
            assertEquals("/performance-reviews/${review.id}/view", published.link)
            assertEquals(
                mapOf(
                    "manager" to "Mona Manager",
                    "startMonth" to period.startMonth,
                    "endMonth" to period.endMonth,
                ),
                published.params,
            )

            manager.post("$url/unpublish")
            val unpublished = reviewNotifications()
                .single { it.type == NotificationType.PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE }
            assertNull(unpublished.link)
        }

    // ---- edits ----

    @Test
    fun `the PUT replaces assessments in DRAFT and CALIBRATION, never in PUBLISHED`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val period = TestReviewPeriods.append()
        val manager = authedClient(pair.managerEmail, "pw")
        val review = manager.createReview(pair.subordinateId, period.id)
        val url = "/api/v1/performance-reviews/${review.id}"

        suspend fun tryPut(body: PerformanceReviewUpdateRequest) = manager.put(url) {
            contentType(ContentType.Application.Json)
            setBody(body)
        }.status

        val updated = PerformanceReviewUpdateRequest(
            attitude = CategoryAssessment(2, "attitude reconsidered"),
            delivery = review.delivery,
            skills = review.skills,
            overall = review.overall,
        )
        // DRAFT edit; a partial payload is fine (blanking delivery entirely).
        assertEquals(HttpStatusCode.NoContent, tryPut(updated.copy(delivery = CategoryAssessment())))
        assertEquals(
            CategoryAssessment(null, null),
            manager.get(url).body<PerformanceReviewResponse>().delivery,
        )
        // Restore completeness, submit, edit again in CALIBRATION.
        assertEquals(HttpStatusCode.NoContent, tryPut(updated))
        manager.post("$url/submit")
        assertEquals(
            HttpStatusCode.NoContent,
            tryPut(updated.copy(overall = CategoryAssessment(6, "calibrated up"))),
        )
        // But in CALIBRATION a value may never blank out.
        assertEquals(HttpStatusCode.BadRequest, tryPut(updated.copy(skills = CategoryAssessment())))
        assertEquals(
            HttpStatusCode.BadRequest,
            tryPut(updated.copy(skills = CategoryAssessment(5, ""))),
        )
        // PUBLISHED is read-only.
        manager.post("$url/publish")
        assertEquals(HttpStatusCode.Conflict, tryPut(updated))

        // The subordinate never edits.
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(pair.subordinateEmail, "pw").put(url) {
                contentType(ContentType.Application.Json)
                setBody(updated)
            }.status,
        )
    }

    @Test
    fun `an edit records one event per changed aspect and a no-op records nothing`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val period = TestReviewPeriods.append()
        val manager = authedClient(pair.managerEmail, "pw")
        val review = manager.createReview(pair.subordinateId, period.id)
        val url = "/api/v1/performance-reviews/${review.id}"

        suspend fun eventCount() = manager.get("$url/events")
            .body<PerformanceReviewEventListResponse>().items.size
        val baseline = eventCount()

        // A no-op PUT (resubmitting the current document) mints nothing.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put(url) {
                contentType(ContentType.Application.Json)
                setBody(
                    PerformanceReviewUpdateRequest(
                        review.attitude, review.delivery, review.skills, review.overall,
                    ),
                )
            }.status,
        )
        assertEquals(baseline, eventCount())

        // One rating change + one summary change = two events, category-tagged, text-free.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put(url) {
                contentType(ContentType.Application.Json)
                setBody(
                    PerformanceReviewUpdateRequest(
                        attitude = CategoryAssessment(1, review.attitude.summary),
                        delivery = CategoryAssessment(review.delivery.rating, "reworded delivery"),
                        skills = review.skills,
                        overall = review.overall,
                    ),
                )
            }.status,
        )
        // Newest first: the freshly minted pair tops the list, reversed against mint order.
        val events = manager.get("$url/events").body<PerformanceReviewEventListResponse>().items
        val minted = events.dropLast(baseline)
        assertEquals(
            listOf(PerformanceReviewEventType.SUMMARY_CHANGED, PerformanceReviewEventType.RATING_CHANGED),
            minted.map { it.type },
        )
        // Category only — rating VALUES never reach the plaintext params (encrypted at rest
        // since v1.49.0), summary text never did.
        assertEquals(mapOf("category" to "DELIVERY"), minted[0].params)
        assertEquals(mapOf("category" to "ATTITUDE"), minted[1].params)
    }

    // ---- delete ----

    @Test
    fun `delete is manager-only and DRAFT-only, and the audit trail survives`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val period = TestReviewPeriods.append()
        val manager = authedClient(pair.managerEmail, "pw")
        val review = manager.createReview(pair.subordinateId, period.id)
        val url = "/api/v1/performance-reviews/${review.id}"

        // Not the subordinate's to delete; not deletable past DRAFT.
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(pair.subordinateEmail, "pw").delete(url).status,
        )
        manager.post("$url/submit")
        assertEquals(HttpStatusCode.BadRequest, manager.delete(url).status)
        manager.post("$url/revert")

        assertEquals(HttpStatusCode.NoContent, manager.delete(url).status)
        assertEquals(HttpStatusCode.NotFound, manager.get(url).status)
        // Idempotent in effect: a second delete is 404.
        assertEquals(HttpStatusCode.NotFound, manager.delete(url).status)

        // The events outlived the soft delete, DELETED included.
        val events = TestPerformanceReviewEvents.service.listForReview(review.id)
        assertTrue(events.any { it.type == PerformanceReviewEventType.DELETED })
    }

    // ---- lists ----

    @Test
    fun `list views scope by role - own is PUBLISHED-only, team hides drafts, user is the HR auditor`() =
        testApplication {
            usePostgresTestcontainer()
            val pair = seedPair()
            val period = TestReviewPeriods.append()
            val (grandEmail, _) = seedGrandManager(pair)
            val manager = authedClient(pair.managerEmail, "pw")
            val subordinate = authedClient(pair.subordinateEmail, "pw")
            val grand = authedClient(grandEmail, "pw")
            val review = manager.createReview(pair.subordinateId, period.id)
            val url = "/api/v1/performance-reviews/${review.id}"

            suspend fun HttpClient.ids(query: String) = get("/api/v1/performance-reviews?$query")
                .body<PerformanceReviewPageResponse>().items.map { it.id }

            // DRAFT: only the manager's managed view lists it.
            assertTrue(review.id in manager.ids("view=managed"))
            assertTrue(review.id !in subordinate.ids("view=own"))
            assertTrue(review.id !in grand.ids("view=team"))
            assertTrue(review.id !in grand.ids("view=managed&includeIndirect=true"))

            // CALIBRATION: the chain lists it; the subordinate still does not.
            manager.post("$url/submit")
            assertTrue(review.id in grand.ids("view=team"))
            assertTrue(review.id in grand.ids("view=managed&includeIndirect=true"))
            assertTrue(review.id !in grand.ids("view=managed")) // direct managed stays own-authored
            assertTrue(review.id !in subordinate.ids("view=own"))

            // PUBLISHED: the subordinate's own list finally carries it — with ratings, never summaries.
            manager.post("$url/publish")
            assertTrue(review.id in subordinate.ids("view=own"))
            val row = subordinate.get("/api/v1/performance-reviews?view=own")
                .body<PerformanceReviewPageResponse>().items.first { it.id == review.id }
            assertEquals(3, row.attitudeRating)
            assertEquals(period.startMonth, row.periodStartMonth)
            assertEquals("Mona Manager", row.managerName)

            // view=user is the HR auditor's: HR sees every status, others are 403.
            val hrEmail = uniqueEmail("review-hr")
            TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
            val hr = authedClient(hrEmail, "pw")
            manager.post("$url/unpublish")
            manager.post("$url/revert") // back to DRAFT
            assertTrue(review.id in hr.ids("view=user&userId=${pair.subordinateId}"))
            assertTrue(review.id in hr.ids("view=user&userId=${pair.managerId}"))
            assertEquals(
                HttpStatusCode.Forbidden,
                manager.get("/api/v1/performance-reviews?view=user&userId=${pair.subordinateId}").status,
            )
            // View-shape validation.
            assertEquals(
                HttpStatusCode.BadRequest,
                hr.get("/api/v1/performance-reviews?view=user").status,
            )
            assertEquals(
                HttpStatusCode.BadRequest,
                hr.get("/api/v1/performance-reviews?view=own&userId=1").status,
            )
            assertEquals(
                HttpStatusCode.BadRequest,
                subordinate.get("/api/v1/performance-reviews?view=own&includeIndirect=true").status,
            )
            assertEquals(
                HttpStatusCode.BadRequest,
                subordinate.get("/api/v1/performance-reviews?view=bogus").status,
            )
        }

    @Test
    fun `list filters and the periodStart sort narrow and order the rows`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val firstPeriod = TestReviewPeriods.append(months = 1)
        val secondPeriod = TestReviewPeriods.append(months = 1)
        val manager = authedClient(pair.managerEmail, "pw")
        val first = manager.createReview(pair.subordinateId, firstPeriod.id)
        val second = manager.createReview(pair.subordinateId, secondPeriod.id)

        suspend fun rows(query: String) = manager.get("/api/v1/performance-reviews?$query")
            .body<PerformanceReviewPageResponse>().items

        // periodId pins one row; status filters; subordinateName substring matches.
        assertEquals(listOf(first.id), rows("view=managed&periodId=${firstPeriod.id}").map { it.id })
        assertEquals(
            listOf(first.id, second.id).sorted(),
            rows("view=managed&subordinateId=${pair.subordinateId}&status=DRAFT").map { it.id }.sorted(),
        )
        assertTrue(rows("view=managed&subordinateName=ordinate").map { it.id }.containsAll(listOf(first.id, second.id)))
        assertEquals(emptyList(), rows("view=managed&subordinateName=zzz-nobody").map { it.id })

        // periodStart sorts chronologically (ISO months compare lexicographically).
        val ascending = rows("view=managed&sort=periodStart&subordinateId=${pair.subordinateId}").map { it.id }
        assertEquals(listOf(first.id, second.id), ascending)
        val descending = rows("view=managed&sort=-periodStart&subordinateId=${pair.subordinateId}").map { it.id }
        assertEquals(listOf(second.id, first.id), descending)

        // Unknown sort fields are 400.
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.get("/api/v1/performance-reviews?view=managed&sort=summary").status,
        )
    }

    @Test
    fun `events are readable exactly by those who may read the review`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val period = TestReviewPeriods.append()
        val manager = authedClient(pair.managerEmail, "pw")
        val subordinate = authedClient(pair.subordinateEmail, "pw")
        val review = manager.createReview(pair.subordinateId, period.id)
        val eventsUrl = "/api/v1/performance-reviews/${review.id}/events"

        // DRAFT: subordinate blocked from the history like from the document.
        assertEquals(HttpStatusCode.Forbidden, subordinate.get(eventsUrl).status)
        manager.post("/api/v1/performance-reviews/${review.id}/submit")
        manager.post("/api/v1/performance-reviews/${review.id}/publish")
        assertEquals(HttpStatusCode.OK, subordinate.get(eventsUrl).status)
        assertEquals(HttpStatusCode.NotFound, manager.get("/api/v1/performance-reviews/999999/events").status)
    }
}
