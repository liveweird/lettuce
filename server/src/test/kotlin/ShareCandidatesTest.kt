package ch.nokillswit

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.reviews.CategoryAssessment
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.reviews.PerformanceReviewShareable
import ch.nokillswit.reviews.PerformanceReviewStatus
import ch.nokillswit.reviews.ShareCandidate
import ch.nokillswit.reviews.ShareCandidateList
import ch.nokillswit.reviews.ShareCandidateReason
import ch.nokillswit.sharing.ShareAccessKey
import ch.nokillswit.sharing.ShareRegistryKey
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamRef
import ch.nokillswit.users.CareerPositionWrite
import ch.nokillswit.users.Feature
import ch.nokillswit.users.OPT_IN_FEATURES
import ch.nokillswit.users.UserRef
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `GET /api/v1/performance-reviews/share-candidates?periodId=` (v4.10.0) — the mass-share
 * picker's dataset: strictly caller-relative over the TRANSITIVE chain (no HR/ADMIN widening,
 * not audited, unpaged), teams / direct managers / career triple per person, the period's review
 * with ratings only when readable in the caller's own right, the D1 stub of another manager's
 * DRAFT, and — the parity cases — `shareable` pinned against the REAL adapter guard run through
 * `ShareAccess.holdsOwnRight` (the `ActivityVisibilityParityTest` precedent).
 */
class ShareCandidatesTest {

    private companion object {
        // The review-period timeline is global, gapless and append-only, and the route-level review
        // creates elsewhere in the suite need a period that has STARTED — so this class takes just
        // two one-month periods for the whole JVM (every test seeds fresh people, so sharing them is
        // safe) instead of one six-month period per test, which would push the shared timeline into
        // the future and break those creates.
        val sharedPeriod by lazy { kotlinx.coroutines.runBlocking { TestReviewPeriods.append(months = 1) } }
        val secondPeriod by lazy { kotlinx.coroutines.runBlocking { TestReviewPeriods.append(months = 1) } }
    }

    private suspend fun person(prefix: String, roles: Set<UserRole> = emptySet(), name: String = prefix): UInt =
        TestUsers.seed(uniqueEmail(prefix), "pw", name = name, roles = roles)

    private suspend fun team(manager: UInt, members: List<UInt>, name: String = "sc-${UUID.randomUUID()}"): UInt =
        TestServices.teams.create(Team(name = name, managerId = manager, memberIds = members))

    private suspend fun review(
        author: UInt,
        subordinate: UInt,
        periodId: UInt,
        periodStart: String,
        status: PerformanceReviewStatus = PerformanceReviewStatus.DRAFT,
        overall: Int = 4,
    ): UInt {
        val id = TestServices.performanceReviews.create(
            author,
            PerformanceReviewCreateRequest(
                subordinateId = subordinate,
                periodId = periodId,
                attitude = CategoryAssessment(3, "a"),
                delivery = CategoryAssessment(4, "d"),
                skills = CategoryAssessment(5, "s"),
                aptitude = CategoryAssessment(2, "p"),
                overall = CategoryAssessment(overall, "o"),
            ),
            periodStart,
        )
        val path = listOf(
            PerformanceReviewStatus.DRAFT, PerformanceReviewStatus.CALIBRATION, PerformanceReviewStatus.PUBLISHED,
        )
        path.zipWithNext().takeWhile { (from, _) -> from != status }.forEach { (from, to) ->
            TestServices.performanceReviews.transition(id, from, to)
        }
        return id
    }

    private suspend fun HttpClient.candidates(periodId: UInt): ShareCandidateList =
        get("/api/v1/performance-reviews/share-candidates?periodId=$periodId").body()

    private fun ShareCandidateList.byId(id: UInt): ShareCandidate = items.single { it.userId == id }

    @Test
    fun `rows are the caller's transitive chain only - deactivated kept, deleted and strangers absent, name order`() =
        testApplication {
            usePostgresTestcontainer()
            val period = sharedPeriod
            val gm = person("sc-gm", name = "Sc Grand")
            val m = person("sc-m", name = "Sc mid")
            val sA = person("sc-sa", name = "Sc Alpha")
            val sB = person("sc-sb", name = "Sc Bravo")
            val deactivated = person("sc-sd", name = "Sc Dormant")
            val deleted = person("sc-sx", name = "Sc Deleted")
            val stranger = person("sc-st", name = "Sc Stranger")
            team(gm, listOf(m))
            team(m, listOf(sB, sA, deactivated, deleted))
            team(stranger, listOf(person("sc-so")))
            TestServices.users.setDeactivated(deactivated, true)
            TestServices.users.delete(deleted)

            val client = authedClient(TestServices.users.read(gm)!!.email, "pw")
            val list = client.candidates(period.id)
            assertEquals(period.id, list.periodId)
            // Name order is case-insensitive then id: Alpha, Bravo, Dormant, mid.
            assertEquals(listOf(sA, sB, deactivated, m), list.items.map { it.userId })
            assertEquals(listOf(false, false, true, false), list.items.map { it.deactivated })
            assertTrue(list.items.none { it.userId in setOf(gm, deleted, stranger) })
            assertEquals(TestServices.users.read(sA)!!.email, list.byId(sA).email)

            // The mid manager sees only their own reports; a non-manager gets [] (no 403).
            val mid = authedClient(TestServices.users.read(m)!!.email, "pw").candidates(period.id)
            assertEquals(listOf(sA, sB, deactivated), mid.items.map { it.userId })
            assertEquals(emptyList(), authedClient(TestServices.users.read(sA)!!.email, "pw").candidates(period.id).items)
        }

    @Test
    fun `teams, direct managers and the career triple ride along - the caller listed as a manager of their own team`() =
        testApplication {
            usePostgresTestcontainer()
            val period = sharedPeriod
            val gm = person("scp-gm", name = "Scp Grand")
            val m = person("scp-m", name = "Scp Middle")
            val outsider = person("scp-o", name = "Scp Dotted")
            val s = person("scp-s", name = "Scp Sub")
            val d = person("scp-d", name = "Scp Direct")
            val lead = team(gm, listOf(m, d), name = "Scp Lead")
            val squad = team(m, listOf(s), name = "Scp Squad")
            val dotted = team(outsider, listOf(s), name = "Scp Dotted line")
            val marker = UUID.randomUUID().toString().take(8)
            val (pathId) = TestDictionaries.append(Dictionary.CAREER_PATH, "Scp P $marker")
            val (specId) = TestDictionaries.append(Dictionary.CAREER_SPECIALIZATION, "Scp S $marker")
            val (levelId) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "Scp L $marker")
            TestServices.careerPositions.create(m, s, CareerPositionWrite("2020-01-01", pathId, specId, levelId))

            val list = authedClient(TestServices.users.read(gm)!!.email, "pw").candidates(period.id)
            assertEquals(listOf(TeamRef(lead, "Scp Lead")), list.byId(d).teams)
            // Direct report of the caller: the caller appears as themselves.
            assertEquals(listOf(UserRef(gm, "Scp Grand")), list.byId(d).directManagers)
            assertEquals(listOf(UserRef(gm, "Scp Grand")), list.byId(m).directManagers)
            // Grand-manager's row lists the middle manager — and an outsider manager outside the chain.
            val sub = list.byId(s)
            assertEquals(listOf(TeamRef(dotted, "Scp Dotted line"), TeamRef(squad, "Scp Squad")), sub.teams)
            assertEquals(listOf(UserRef(outsider, "Scp Dotted"), UserRef(m, "Scp Middle")), sub.directManagers)
            // Career triple with seniority ALWAYS attached (chain rows); no positions = nulls.
            assertEquals(DictionaryEntry(pathId, mapOf("en" to "Scp P $marker")), sub.careerPath)
            assertEquals(DictionaryEntry(specId, mapOf("en" to "Scp S $marker")), sub.careerSpecialization)
            assertEquals(DictionaryEntry(levelId, mapOf("en" to "Scp L $marker")), sub.seniorityLevel)
            assertNull(list.byId(d).careerPath)
            assertNull(list.byId(d).seniorityLevel)
        }

    @Test
    fun `the review join - own and published rows carry ratings, another manager's DRAFT is an id-less stub`() =
        testApplication {
            usePostgresTestcontainer()
            val period = sharedPeriod
            val other = secondPeriod
            val gm = person("scr-gm", name = "Scr Grand")
            val m = person("scr-m", name = "Scr Middle")
            val ownDraft = person("scr-a", name = "Scr Own draft")
            val calibration = person("scr-b", name = "Scr Calibration")
            val published = person("scr-c", name = "Scr Published")
            val foreignDraft = person("scr-d", name = "Scr Foreign draft")
            val none = person("scr-e", name = "Scr None")
            val otherPeriodOnly = person("scr-f", name = "Scr Other period")
            val deletedReview = person("scr-g", name = "Scr Deleted review")
            team(gm, listOf(m))
            team(m, listOf(ownDraft, calibration, published, foreignDraft, none, otherPeriodOnly, deletedReview))
            val start = period.startMonth
            val ownId = review(gm, ownDraft, period.id, start, PerformanceReviewStatus.DRAFT, overall = 6)
            val calId = review(m, calibration, period.id, start, PerformanceReviewStatus.CALIBRATION, overall = 5)
            val pubId = review(m, published, period.id, start, PerformanceReviewStatus.PUBLISHED, overall = 3)
            val foreignId = review(m, foreignDraft, period.id, start, PerformanceReviewStatus.DRAFT, overall = 1)
            review(m, otherPeriodOnly, other.id, other.startMonth)
            val gone = review(m, deletedReview, period.id, start)
            TestServices.performanceReviews.delete(gone)

            val list = authedClient(TestServices.users.read(gm)!!.email, "pw").candidates(period.id)

            val own = list.byId(ownDraft)
            assertTrue(own.shareable)
            assertNull(own.reason)
            assertNotNull(own.review)
            assertEquals(ownId, own.review.id)
            assertEquals(PerformanceReviewStatus.DRAFT, own.review.status)
            assertEquals(listOf(3, 4, 5, 2, 6), own.review.let {
                listOf(it.attitudeRating, it.deliveryRating, it.skillsRating, it.aptitudeRating, it.overallRating)
            })
            assertEquals(gm, own.review.managerId)

            val cal = list.byId(calibration)
            assertTrue(cal.shareable)
            assertNotNull(cal.review)
            assertEquals(calId, cal.review.id)
            assertEquals(5, cal.review.overallRating)
            assertEquals("Scr Middle", cal.review.managerName)

            val pub = list.byId(published)
            assertTrue(pub.shareable)
            assertNotNull(pub.review)
            assertEquals(pubId, pub.review.id)

            // D1: another chain manager's DRAFT - status + author only, never the id or a rating.
            val stub = list.byId(foreignDraft)
            assertTrue(!stub.shareable)
            assertEquals(ShareCandidateReason.UNREADABLE_DRAFT, stub.reason)
            val stubReview = assertNotNull(stub.review)
            assertNull(stubReview.id)
            assertEquals(PerformanceReviewStatus.DRAFT, stubReview.status)
            assertNull(stubReview.managerId)
            assertEquals("Scr Middle", stubReview.managerName)
            assertEquals(
                listOf(null, null, null, null, null),
                stubReview.let {
                    listOf(it.attitudeRating, it.deliveryRating, it.skillsRating, it.aptitudeRating, it.overallRating)
                },
            )
            assertTrue(foreignId > 0u)

            // No review in this period: a review of ANOTHER period or a soft-deleted one never counts.
            for (id in listOf(none, otherPeriodOnly, deletedReview)) {
                val row = list.byId(id)
                assertNull(row.review)
                assertTrue(!row.shareable)
                assertEquals(ShareCandidateReason.NO_REVIEW, row.reason)
            }
        }

    @Test
    fun `an HR or ADMIN caller gets no widening and no audit event - only their own chain, the chain draft still a stub`() =
        testApplication {
            usePostgresTestcontainer()
            val period = sharedPeriod
            val m = person("sch-m", name = "Sch Middle")
            val s = person("sch-s", name = "Sch Sub")
            team(m, listOf(s))
            review(m, s, period.id, period.startMonth)
            val hr = person("sch-hr", roles = setOf(UserRole.HR))
            val admin = person("sch-ad", roles = setOf(UserRole.ADMIN))
            val hrManager = person("sch-hm", roles = setOf(UserRole.HR))
            team(hrManager, listOf(m))
            val capture = LogCapture("ch.nokillswit.audit")
            try {
                for (id in listOf(hr, admin)) {
                    assertEquals(
                        emptyList(),
                        authedClient(TestServices.users.read(id)!!.email, "pw").candidates(period.id).items,
                    )
                }
                // An HR user who manages m sees m and s - the draft by m stays an unreadable stub.
                val list = authedClient(TestServices.users.read(hrManager)!!.email, "pw").candidates(period.id)
                assertEquals(setOf(m, s), list.items.map { it.userId }.toSet())
                assertEquals(ShareCandidateReason.UNREADABLE_DRAFT, list.byId(s).reason)
                assertNull(list.byId(s).review!!.id)
                assertEquals(0, capture.events.count { it.message.startsWith("hr.") })
            } finally {
                capture.detach()
            }
        }

    @Test
    fun `401 without a token, 403 with the feature off, 400 for a missing, malformed, repeated or unknown periodId`() =
        testApplication {
            usePostgresTestcontainer()
            val period = sharedPeriod
            assertEquals(
                HttpStatusCode.Unauthorized,
                jsonClient().get("/api/v1/performance-reviews/share-candidates?periodId=${period.id}").status,
            )
            val blocked = person("scv-b")
            TestServices.users.setDisabledFeatures(blocked, setOf(Feature.PERFORMANCE_REVIEWS) + OPT_IN_FEATURES)
            val disabled = authedClient(TestServices.users.read(blocked)!!.email, "pw")
            assertEquals(
                HttpStatusCode.Forbidden,
                disabled.get("/api/v1/performance-reviews/share-candidates?periodId=${period.id}").status,
            )
            // The feature 403 precedes the shape 400.
            assertEquals(
                HttpStatusCode.Forbidden,
                disabled.get("/api/v1/performance-reviews/share-candidates").status,
            )

            val client = authedClient(TestServices.users.read(person("scv-ok"))!!.email, "pw")
            val base = "/api/v1/performance-reviews/share-candidates"
            for (query in listOf("", "?periodId=", "?periodId=abc", "?periodId=-1", "?periodId=999999999",
                "?periodId=${period.id}&periodId=${period.id}")) {
                assertEquals(HttpStatusCode.BadRequest, client.get("$base$query").status, "query '$query'")
            }
            assertEquals(HttpStatusCode.OK, client.get("$base?periodId=${period.id}").status)
        }

    /**
     * The in-memory shareability rule against the REAL adapter guard: GM → M → M2, persons at
     * three chain depths (D under GM, E under M, F under M2) each with a review of every status
     * authored by each of the three managers — so for every caller (GM, M, M2) the matrix holds
     * the caller's own reviews and another chain manager's at DRAFT/CALIBRATION/PUBLISHED. Run
     * for an HR-holding and a role-less top manager (HR must change nothing).
     */
    @Test
    fun `shareable agrees with holdsOwnRight over the real adapter guard - statuses, authors, depths, HR or not`() =
        testApplication {
            usePostgresTestcontainer()
            val period = sharedPeriod
            val adapter = application.attributes[ShareRegistryKey].forType(ShareableResourceType.PERFORMANCE_REVIEW)
                as PerformanceReviewShareable
            val access = application.attributes[ShareAccessKey]
            var checked = 0
            for (topRoles in listOf(emptySet(), setOf(UserRole.HR))) {
                val gm = person("scx-gm", topRoles)
                val m = person("scx-m")
                val m2 = person("scx-m2")
                val managers = listOf(gm, m, m2)
                val d = (0 until 9).map { person("scx-d") }
                val e = (0 until 9).map { person("scx-e") }
                val f = (0 until 9).map { person("scx-f") }
                team(gm, listOf(m) + d)
                team(m, listOf(m2) + e)
                team(m2, f)
                val matrix = listOf(d, e, f).flatMap { group ->
                    managers.flatMap { author ->
                        PerformanceReviewStatus.entries.map { author to it }
                    }.mapIndexed { i, (author, status) -> Triple(group[i], author, status) }
                }
                val reviewIds = matrix.associate { (subordinate, author, status) ->
                    subordinate to review(author, subordinate, period.id, period.startMonth, status)
                }
                for (caller in managers) {
                    val roles = if (caller == gm) topRoles else emptySet()
                    val principal = CallerPrincipal(caller, "caller-$caller@test", roles)
                    val rows = authedClient(TestServices.users.read(caller)!!.email, "pw")
                        .candidates(period.id).items.associateBy { it.userId }
                    for ((subordinate, reviewId) in reviewIds) {
                        val row = rows[subordinate] ?: continue // not in this caller's chain
                        val doc = checkNotNull(adapter.read(reviewId))
                        val viaGuard = access.holdsOwnRight(principal, ShareableResourceType.PERFORMANCE_REVIEW) {
                            adapter.guard(it, doc)
                        }
                        assertEquals(viaGuard, row.shareable, "caller=$caller sub=$subordinate ${doc.status} by ${doc.managerId}")
                        assertEquals(viaGuard, row.review!!.id != null)
                        checked++
                    }
                }
            }
            // Per org: GM sees 27 people, M sees 18 (E, F), M2 sees 9 (F) = 54, doubled for the HR run.
            assertEquals(108, checked)
        }
}
