package ch.nokillswit

import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackPageResponse
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackSubject
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamMemberPageResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.sql.DriverManager
import java.util.UUID
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Multi-recipient feedback (v3.1.0, V72): one record addressing up to four people. Creation
 * rules, the recipient-set views (every recipient reads it and finds it in Received; the chain
 * of ANY recipient reads it once delivered), the per-recipient duplicate rule, the notification
 * fan-out, the /teams/members "last feedback given" stat, and the V72 backfill.
 */
class FeedbackMultiSubjectTest {

    private data class Party(val email: String, val id: UInt, val name: String)

    private suspend fun seedParty(prefix: String, name: String, roles: Set<UserRole> = emptySet()): Party {
        val email = uniqueEmail(prefix)
        return Party(email, TestUsers.seed(email = email, password = "pw", roles = roles, name = name), name)
    }

    private suspend fun HttpClient.createFeedback(
        subjectId: UInt,
        additional: List<UInt>,
        providerId: UInt,
        status: FeedbackStatus = FeedbackStatus.SENT,
        visibility: FeedbackVisibility = FeedbackVisibility.PROVIDER_SUBJECT,
        requesterId: UInt? = null,
        content: String = "Well done, all of you",
    ): HttpResponse = post("/api/v1/feedbacks") {
        contentType(ContentType.Application.Json)
        setBody(
            FeedbackCreateRequest(
                requesterId = requesterId,
                subjectId = subjectId,
                additionalSubjectIds = additional,
                providerId = providerId,
                visibility = visibility,
                status = status,
                content = content,
            ),
        )
    }

    private suspend fun ApplicationTestBuilder.notificationsOf(email: String): List<NotificationResponse> =
        authedClient(email, "pw").get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>().items

    private suspend fun teamOf(managerId: UInt, vararg memberIds: UInt): UInt {
        val teamId = TestServices.teams.create(Team(name = "multi-${UUID.randomUUID()}", managerId = managerId))
        memberIds.forEach { TestServices.teams.addMember(teamId, it) }
        return teamId
    }

    @Test
    fun `create with two to four recipients round-trips the ordered subjects list`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val a = seedParty("a", "Ann A")
        val b = seedParty("b", "Ben B")
        val c = seedParty("c", "Cy C")
        val d = seedParty("d", "Di D")
        val client = authedClient(provider.email, "pw")

        for (extras in listOf(listOf(b), listOf(b, c), listOf(b, c, d))) {
            val response = client.createFeedback(a.id, extras.map { it.id }, provider.id, status = FeedbackStatus.DRAFT)
            assertEquals(HttpStatusCode.Created, response.status, "extras=${extras.size}")
            val created = response.body<FeedbackResponse>()
            assertEquals((listOf(a) + extras).map { FeedbackSubject(it.id, it.name) }, created.subjects)
            // The legacy trio stays the first recipient.
            assertEquals(a.id, created.subjectId)
            assertEquals("Ann A", created.subjectName)
            val read = client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>()
            assertEquals(created, read)
            // Discard so the next round's overlapping recipients don't trip the duplicate rule.
            assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/feedbacks/${created.id}/withdraw").status)
        }
    }

    @Test
    fun `the recipient-set rules answer 400 with a distinct message each`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val requester = seedParty("requester", "Rita Requester")
        val people = (1..5).map { seedParty("p$it", "Person $it") }
        val ids = people.map { it.id }
        val client = authedClient(provider.email, "pw")

        suspend fun expect400(detail: String, block: suspend () -> HttpResponse) {
            val response = block()
            assertEquals(HttpStatusCode.BadRequest, response.status, detail)
            assertEquals(detail, response.body<ProblemDetail>().detail)
        }

        expect400("A feedback may have at most 4 subjects") {
            client.createFeedback(ids[0], ids.drop(1), provider.id)
        }
        expect400("Subjects must be distinct") {
            client.createFeedback(ids[0], listOf(ids[1], ids[0]), provider.id)
        }
        expect400("Feedback about yourself is not supported") {
            client.createFeedback(ids[0], listOf(provider.id), provider.id)
        }
        expect400("A requested feedback must have exactly one subject") {
            authedClient(requester.email, "pw").createFeedback(
                ids[0], listOf(ids[1]), provider.id,
                status = FeedbackStatus.REQUESTED,
                visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                requesterId = requester.id,
            )
        }
        expect400("Referenced user does not exist") {
            client.createFeedback(ids[0], listOf(999_999u), provider.id)
        }
        // A deactivated extra recipient is a new assignment → the no-deactivated-parties rule.
        val admin = seedParty("admin", "Ada Admin", roles = setOf(UserRole.ADMIN))
        assertEquals(
            HttpStatusCode.NoContent,
            authedClient(admin.email, "pw").post("/api/v1/users/${ids[2]}/deactivate").status,
        )
        val deactivated = client.createFeedback(ids[0], listOf(ids[1], ids[2]), provider.id)
        assertEquals(HttpStatusCode.BadRequest, deactivated.status)
    }

    @Test
    fun `every recipient reads a delivered feedback and finds it in Received, nobody else does`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val a = seedParty("a", "Ann A")
        val b = seedParty("b", "Ben B")
        val stranger = seedParty("stranger", "Stan Stranger")
        val client = authedClient(provider.email, "pw")

        val draft = client.createFeedback(a.id, listOf(b.id), provider.id, status = FeedbackStatus.DRAFT)
            .body<FeedbackResponse>()
        // A DRAFT stays private to the provider — recipients included.
        assertEquals(HttpStatusCode.Forbidden, authedClient(b.email, "pw").get("/api/v1/feedbacks/${draft.id}").status)
        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/feedbacks/${draft.id}/send").status)

        for (recipient in listOf(a, b)) {
            val theirs = authedClient(recipient.email, "pw")
            val read = theirs.get("/api/v1/feedbacks/${draft.id}")
            assertEquals(HttpStatusCode.OK, read.status, recipient.email)
            assertEquals("Well done, all of you", read.body<FeedbackResponse>().content)
            val received = theirs.get("/api/v1/feedbacks?view=received").body<FeedbackPageResponse>()
            val row = received.items.single { it.id == draft.id }
            assertEquals(listOf(a.id, b.id), row.subjects.map { it.id })
            assertEquals(listOf("Ann A", "Ben B"), row.subjects.map { it.name })
        }
        val other = authedClient(stranger.email, "pw")
        assertEquals(HttpStatusCode.Forbidden, other.get("/api/v1/feedbacks/${draft.id}").status)
        assertTrue(other.get("/api/v1/feedbacks?view=received").body<FeedbackPageResponse>().items.none { it.id == draft.id })
    }

    @Test
    fun `subjectId and subjectName filters match an extra recipient, accent-insensitively`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val a = seedParty("a", "Ann A")
        val zolw = seedParty("z", "Żółw Extra")
        val client = authedClient(provider.email, "pw")
        val created = client.createFeedback(a.id, listOf(zolw.id), provider.id).body<FeedbackResponse>()
        // A control row about Ann alone must NOT match the extra-recipient filters.
        val control = client.createFeedback(a.id, emptyList(), provider.id, content = "control").body<FeedbackResponse>()

        val byId = client.get("/api/v1/feedbacks?view=provided&subjectId=${zolw.id}").body<FeedbackPageResponse>()
        assertEquals(listOf(created.id), byId.items.map { it.id })
        val byName = client.get("/api/v1/feedbacks?view=provided&subjectName=zolw").body<FeedbackPageResponse>()
        assertEquals(listOf(created.id), byName.items.map { it.id })
        // The anchor still matches through the same filter.
        val byAnchor = client.get("/api/v1/feedbacks?view=provided&subjectName=ann").body<FeedbackPageResponse>()
        assertEquals(setOf(created.id, control.id), byAnchor.items.map { it.id }.toSet())
    }

    @Test
    fun `a manager in the SECOND recipient's chain reads and lists it once delivered`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val a = seedParty("a", "Ann A")
        val b = seedParty("b", "Ben B")
        val manager = seedParty("manager", "Mia Manager")
        val grand = seedParty("grand", "Gus Grand")
        teamOf(manager.id, b.id)
        teamOf(grand.id, manager.id)
        val client = authedClient(provider.email, "pw")
        val managerClient = authedClient(manager.email, "pw")
        val grandClient = authedClient(grand.email, "pw")

        val draft = client.createFeedback(a.id, listOf(b.id), provider.id, status = FeedbackStatus.DRAFT)
            .body<FeedbackResponse>()
        assertEquals(HttpStatusCode.Forbidden, managerClient.get("/api/v1/feedbacks/${draft.id}").status)
        assertTrue(managerClient.get("/api/v1/feedbacks?view=team").body<FeedbackPageResponse>().items.none { it.id == draft.id })

        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/feedbacks/${draft.id}/send").status)
        assertEquals(HttpStatusCode.OK, managerClient.get("/api/v1/feedbacks/${draft.id}").status)
        assertEquals(HttpStatusCode.OK, managerClient.get("/api/v1/feedbacks/${draft.id}/events").status)
        // The grand-manager (chain above the second recipient) reads too; the direct-only
        // team list excludes them until includeIndirect widens it.
        assertEquals(HttpStatusCode.OK, grandClient.get("/api/v1/feedbacks/${draft.id}").status)
        val direct = managerClient.get("/api/v1/feedbacks?view=team").body<FeedbackPageResponse>()
        assertEquals(listOf(a.id, b.id), direct.items.single { it.id == draft.id }.subjects.map { it.id })
        assertTrue(grandClient.get("/api/v1/feedbacks?view=team").body<FeedbackPageResponse>().items.none { it.id == draft.id })
        val indirect = grandClient.get("/api/v1/feedbacks?view=team&includeIndirect=true").body<FeedbackPageResponse>()
        assertTrue(indirect.items.any { it.id == draft.id })
    }

    @Test
    fun `HR finds a multi-recipient feedback under the extra recipient's audit view`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val a = seedParty("a", "Ann A")
        val b = seedParty("b", "Ben B")
        val hr = seedParty("hr", "Harry Auditor", roles = setOf(UserRole.HR))
        val created = authedClient(provider.email, "pw")
            .createFeedback(a.id, listOf(b.id), provider.id, status = FeedbackStatus.DRAFT)
            .body<FeedbackResponse>()

        val audit = authedClient(hr.email, "pw")
            .get("/api/v1/feedbacks?view=user&userId=${b.id}").body<FeedbackPageResponse>()
        assertEquals(listOf(created.id), audit.items.map { it.id })
    }

    @Test
    fun `the duplicate rule is per recipient in both directions`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val a = seedParty("a", "Ann A")
        val b = seedParty("b", "Ben B")
        val c = seedParty("c", "Cy C")
        val client = authedClient(provider.email, "pw")

        // An open multi draft for [A, B] blocks a new single draft for B…
        val multi = client.createFeedback(a.id, listOf(b.id), provider.id, status = FeedbackStatus.DRAFT)
            .body<FeedbackResponse>()
        val single = client.createFeedback(b.id, emptyList(), provider.id, status = FeedbackStatus.DRAFT)
        assertEquals(HttpStatusCode.Conflict, single.status)
        assertEquals("/api/v1/feedbacks/${multi.id}", single.body<ProblemDetail>().instance)
        // …and the duplicate-check probe reports it for B alone.
        val probe = client.get("/api/v1/feedbacks/duplicate-check?subjectId=${b.id}&providerId=${provider.id}")
            .body<DuplicateProbe>()
        assertEquals(multi.id, probe.existingId)
        // A disjoint set is fine.
        assertEquals(HttpStatusCode.Created, client.createFeedback(c.id, emptyList(), provider.id, status = FeedbackStatus.DRAFT).status)
        // The other direction: an open single draft for C blocks a new multi draft naming C.
        val blocked = client.createFeedback(a.id, listOf(c.id), provider.id, status = FeedbackStatus.DRAFT)
        assertEquals(HttpStatusCode.Conflict, blocked.status)
    }

    @kotlinx.serialization.Serializable
    private data class DuplicateProbe(val existingId: UInt?, val existingStatus: FeedbackStatus?)

    @Test
    fun `sending fans out to every recipient, their managers, and the provider with the joined names`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val a = seedParty("a", "Ann A")
        val b = seedParty("b", "Ben B")
        val managerOfA = seedParty("mgr-a", "Mia Manager")
        teamOf(managerOfA.id, a.id)
        // B manages A's sibling team — B is BOTH a recipient and a direct manager of A: the
        // recipient note wins, no manager note.
        teamOf(b.id, a.id)
        val client = authedClient(provider.email, "pw")

        val created = client.createFeedback(a.id, listOf(b.id), provider.id).body<FeedbackResponse>()

        for ((recipient, ownName) in listOf(a to "Ann A", b to "Ben B")) {
            val notes = notificationsOf(recipient.email)
            val sent = notes.single { it.type == NotificationType.FEEDBACK_SENT_TO_SUBJECT }
            assertEquals(ownName, sent.params["subject"])
            assertEquals("Pat Provider", sent.params["provider"])
            assertEquals("/feedback/${created.id}/view", sent.link)
            assertTrue(notes.none { it.type == NotificationType.FEEDBACK_SENT_TO_MANAGER }, recipient.email)
        }
        val toProvider = notificationsOf(provider.email).single { it.type == NotificationType.FEEDBACK_SENT_TO_PROVIDER }
        assertEquals("Ann A, Ben B", toProvider.params["subject"])
        val toManager = notificationsOf(managerOfA.email).single { it.type == NotificationType.FEEDBACK_SENT_TO_MANAGER }
        assertEquals("Ann A, Ben B", toManager.params["subject"])

        // Withdrawing notifies every recipient again, each by their own name.
        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/feedbacks/${created.id}/withdraw").status)
        for ((recipient, ownName) in listOf(a to "Ann A", b to "Ben B")) {
            val withdrawn = notificationsOf(recipient.email).single { it.type == NotificationType.FEEDBACK_WITHDRAWN_TO_SUBJECT }
            assertEquals(ownName, withdrawn.params["subject"])
        }
    }

    @Test
    fun `lastFeedbackGivenAt counts a multi-recipient feedback for each peer`() = testApplication {
        usePostgresTestcontainer()
        val caller = seedParty("caller", "Cal Caller")
        val peer1 = seedParty("peer1", "Peer One")
        val peer2 = seedParty("peer2", "Peer Two")
        val manager = seedParty("mgr", "Mia Manager")
        teamOf(manager.id, caller.id, peer1.id, peer2.id)
        val client = authedClient(caller.email, "pw")

        val created = client.createFeedback(peer1.id, listOf(peer2.id), caller.id).body<FeedbackResponse>()
        val page = client.get("/api/v1/teams/members?view=member&pageSize=100").body<TeamMemberPageResponse>()
        val given1 = page.items.first { it.userId == peer1.id }.lastFeedbackGivenAt
        val given2 = page.items.first { it.userId == peer2.id }.lastFeedbackGivenAt
        assertNotNull(given1)
        assertEquals(given1, given2)

        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/feedbacks/${created.id}/withdraw").status)
        val after = client.get("/api/v1/teams/members?view=member&pageSize=100").body<TeamMemberPageResponse>()
        assertNull(after.items.first { it.userId == peer1.id }.lastFeedbackGivenAt)
        assertNull(after.items.first { it.userId == peer2.id }.lastFeedbackGivenAt)
    }

    @Test
    fun `a row without join rows falls back to its anchor everywhere`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val a = seedParty("a", "Ann A")
        // Inserted below create() (the legacy shape): no feedback_subjects row.
        val id = suspendTransaction(TestServices.feedbacks.database) {
            FeedbackService.Feedbacks.insert {
                it[subjectId] = a.id
                it[providerId] = provider.id
                it[visibility] = FeedbackVisibility.PROVIDER_SUBJECT
                it[status] = FeedbackStatus.SENT
                it[content] = "legacy"
                it[lastModified] = System.currentTimeMillis()
            }[FeedbackService.Feedbacks.id].value
        }
        assertEquals(listOf(a.id), TestServices.feedbacks.read(id)!!.subjectIds)

        val client = authedClient(provider.email, "pw")
        val single = client.get("/api/v1/feedbacks/$id").body<FeedbackResponse>()
        assertEquals(listOf(FeedbackSubject(a.id, "Ann A")), single.subjects)
        val row = client.get("/api/v1/feedbacks?view=provided").body<FeedbackPageResponse>().items.single { it.id == id }
        assertEquals(listOf(FeedbackSubject(a.id, "Ann A")), row.subjects)
        // …and the recipient's own inbox still finds it through the anchor.
        val received = authedClient(a.email, "pw").get("/api/v1/feedbacks?view=received").body<FeedbackPageResponse>()
        assertTrue(received.items.any { it.id == id })
    }

    @Test
    fun `V72 backfills every pre-existing feedback as its single subject at position 0`() {
        // A fresh schema migrated to V71, one feedback inserted the pre-V72 way, then the rest.
        val schema = "v72_check_" + UUID.randomUUID().toString().replace("-", "").take(8)
        fun flyway(target: String?) = Flyway.configure()
            .dataSource(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password)
            .locations("classpath:db/migration")
            .schemas(schema)
            .apply { if (target != null) target(target) }
            .load()
        flyway("71").migrate()
        DriverManager.getConnection(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password).use { conn ->
            conn.createStatement().use { it.execute("SET search_path TO $schema") }
            conn.createStatement().use {
                it.execute(
                    "INSERT INTO users (name, email, password_hash) VALUES ('Legacy Subject', 'legacy-subject@x', 'h')",
                )
                it.execute(
                    "INSERT INTO feedbacks (subject_id, provider_id, visibility, status, content, last_modified) " +
                        "SELECT u.id, 1, 'PROVIDER_SUBJECT', 'SENT', 'legacy', 0 FROM users u WHERE u.email = 'legacy-subject@x'",
                )
            }
            flyway(null).migrate()
            conn.createStatement().use { st ->
                st.executeQuery(
                    "SELECT f.id, f.subject_id, s.user_id, s.position FROM feedbacks f " +
                        "JOIN feedback_subjects s ON s.feedback_id = f.id",
                ).use { rs ->
                    assertTrue(rs.next(), "the backfill row exists")
                    assertEquals(rs.getLong("subject_id"), rs.getLong("user_id"))
                    assertEquals(0, rs.getInt("position"))
                    assertTrue(!rs.next(), "exactly one join row per legacy feedback")
                }
            }
            conn.createStatement().use { it.execute("DROP SCHEMA $schema CASCADE") }
        }
    }

    @Test
    fun `the service seeds join rows for every recipient a test creates directly`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val a = seedParty("a", "Ann A")
        val b = seedParty("b", "Ben B")
        val id = TestServices.feedbacks.create(
            Feedback(
                subjectId = a.id,
                additionalSubjectIds = listOf(b.id),
                providerId = provider.id,
                visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                status = FeedbackStatus.SENT,
            ),
        ).id
        assertEquals(listOf(a.id, b.id), TestServices.feedbacks.read(id)!!.subjectIds)
        val stored = TestServices.feedbacks.read(id)!!
        assertEquals(listOf("Ann A", "Ben B"), TestServices.feedbacks.subjectsOf(id, stored, emptyMap()).map { it.name })
    }
}
