package ch.nokillswit

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.teams.Team
import ch.nokillswit.users.CareerPositionList
import ch.nokillswit.users.CareerPositionResponse
import ch.nokillswit.users.CareerPositionWrite
import ch.nokillswit.users.UserResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The career position timeline (v2.15.0; full-triple writes since v2.15.1): CRUD with the
 * derived end dates (the start-only model), the append/correct ordering rules (409), the
 * transitive-chain write guard vs the any-authenticated read, dictionary-ref validation and
 * resolution (renames propagate, soft-deleted refs keep resolving, corrections resubmitting
 * a stale ref never trip over it), the current-position triple flowing into the user
 * responses, the adjacent-sameness rule (v2.15.2: no position may repeat its neighbor's exact
 * triple — 409), and the owner notification (create only). Positions use far-past dates
 * freely — nothing else keys on them.
 */
class CareerPositionRoutesTest {

    private suspend fun HttpClient.createPosition(
        userId: UInt,
        startDate: String,
        careerPathId: UInt?,
        careerSpecializationId: UInt?,
        seniorityLevelId: UInt?,
    ): HttpResponse = post("/api/v1/users/$userId/career-positions") {
        contentType(ContentType.Application.Json)
        setBody(CareerPositionWrite(startDate, careerPathId, careerSpecializationId, seniorityLevelId))
    }

    private suspend fun HttpClient.listPositions(userId: UInt): List<CareerPositionResponse> =
        get("/api/v1/users/$userId/career-positions").body<CareerPositionList>().items

    /** One spec + level entry per test (the triple is fully required since v2.15.1). */
    private suspend fun specAndLevel(marker: String): Pair<UInt, UInt> {
        val (specId) = TestDictionaries.append(Dictionary.CAREER_SPECIALIZATION, "CpSpec $marker")
        val (levelId) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "CpLevel $marker")
        return specId to levelId
    }

    @Test
    fun `positions CRUD - derived end dates, corrections, soft delete, and the current triple`() =
        testApplication {
            usePostgresTestcontainer()
            val mgrEmail = uniqueEmail("cp-m")
            val subEmail = uniqueEmail("cp-s")
            val mgrId = TestUsers.seed(mgrEmail, "pw", name = "CP Mgr", roles = emptySet())
            val subId = TestUsers.seed(subEmail, "pw", name = "CP Sub", roles = emptySet())
            val teamId = TestServices.teams.create(Team(name = "cp-${UUID.randomUUID()}", managerId = mgrId))
            TestServices.teams.addMember(teamId, subId)
            val manager = authedClient(mgrEmail, "pw")
            val sub = authedClient(subEmail, "pw")

            val marker = UUID.randomUUID().toString().take(8)
            val (pathId, pathId2) = TestDictionaries.append(Dictionary.CAREER_PATH, "CpA $marker", "CpB $marker")
            val (specId, levelId) = specAndLevel(marker)
            val (specId2) = TestDictionaries.append(Dictionary.CAREER_SPECIALIZATION, "CpSpec2 $marker")

            // Create: 201 + Location + the resolved open-ended position with the full triple.
            val response = manager.createPosition(subId, "2019-02-01", pathId, specId, levelId)
            assertEquals(HttpStatusCode.Created, response.status)
            val first = response.body<CareerPositionResponse>()
            assertEquals("/api/v1/users/$subId/career-positions/${first.id}", response.headers["Location"])
            assertEquals("2019-02-01", first.startDate)
            assertNull(first.endDate)
            assertEquals(DictionaryEntry(pathId, "CpA $marker", "CpA $marker"), first.careerPath)
            assertEquals(DictionaryEntry(specId, "CpSpec $marker", "CpSpec $marker"), first.careerSpecialization)
            assertEquals(DictionaryEntry(levelId, "CpLevel $marker", "CpLevel $marker"), first.seniorityLevel)

            // A second position concludes the first the day before its start.
            val second = manager.createPosition(subId, "2021-06-15", pathId2, specId, levelId)
                .body<CareerPositionResponse>()
            val listed = sub.listPositions(subId)
            assertEquals(listOf(first.id, second.id), listed.map { it.id })
            assertEquals("2021-06-14", listed[0].endDate)
            assertNull(listed[1].endDate)

            // The CURRENT (latest) position backs the user's resolved triple.
            val adminEmail = uniqueEmail("cp-a")
            TestUsers.seed(adminEmail, "pw")
            val admin = authedClient(adminEmail, "pw")
            val userRead = admin.get("/api/v1/users/$subId").body<UserResponse>()
            assertEquals(DictionaryEntry(pathId2, "CpB $marker", "CpB $marker"), userRead.careerPath)
            assertEquals(DictionaryEntry(levelId, "CpLevel $marker", "CpLevel $marker"), userRead.seniorityLevel)

            // Correct the FIRST position in place: date + a different path (the spec differs
            // too — a correction may not make the row identical to its neighbor, v2.15.2).
            val put = manager.put("/api/v1/users/$subId/career-positions/${first.id}") {
                contentType(ContentType.Application.Json)
                setBody(CareerPositionWrite("2019-05-01", pathId2, specId2, levelId))
            }
            assertEquals(HttpStatusCode.NoContent, put.status)
            val corrected = sub.listPositions(subId).first()
            assertEquals("2019-05-01", corrected.startDate)
            assertEquals(DictionaryEntry(pathId2, "CpB $marker", "CpB $marker"), corrected.careerPath)
            assertEquals(DictionaryEntry(specId2, "CpSpec2 $marker", "CpSpec2 $marker"), corrected.careerSpecialization)

            // A positionId under the WRONG user's path is 404, not a cross-user edit.
            val foreign = manager.put("/api/v1/users/$mgrId/career-positions/${first.id}") {
                contentType(ContentType.Application.Json)
                setBody(CareerPositionWrite("2019-05-01", pathId, specId, levelId))
            }
            assertEquals(HttpStatusCode.NotFound, foreign.status)

            // Soft delete: the row leaves the timeline, repeats 404, the survivor reopens.
            assertEquals(
                HttpStatusCode.NoContent,
                manager.delete("/api/v1/users/$subId/career-positions/${second.id}").status,
            )
            val remaining = sub.listPositions(subId)
            assertEquals(listOf(first.id), remaining.map { it.id })
            assertNull(remaining.single().endDate)
            assertEquals(
                HttpStatusCode.NotFound,
                manager.delete("/api/v1/users/$subId/career-positions/${second.id}").status,
            )

            // The freed (user, start) pair is reusable after the soft delete.
            assertEquals(
                HttpStatusCode.Created,
                manager.createPosition(subId, "2021-06-15", pathId2, specId, levelId).status,
            )

            // GET of an unknown user is 404 (the read-before-guard pick).
            assertEquals(HttpStatusCode.NotFound, sub.get("/api/v1/users/999999999/career-positions").status)
        }

    @Test
    fun `ordering and shape rules - append-after-latest, between-neighbors, 400 sweep`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("cpo-m")
        val subEmail = uniqueEmail("cpo-s")
        val mgrId = TestUsers.seed(mgrEmail, "pw", roles = emptySet())
        val subId = TestUsers.seed(subEmail, "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "cpo-${UUID.randomUUID()}", managerId = mgrId))
        TestServices.teams.addMember(teamId, subId)
        val manager = authedClient(mgrEmail, "pw")

        val marker = UUID.randomUUID().toString().take(8)
        // Distinct path per row: same-triple neighbors are their own 409 (the sameness test).
        val (pathA, pathB, pathC) = TestDictionaries.append(
            Dictionary.CAREER_PATH, "CpO A $marker", "CpO B $marker", "CpO C $marker",
        )
        val (specId, levelId) = specAndLevel(marker)
        suspend fun create(start: String, path: UInt? = pathA, spec: UInt? = specId, level: UInt? = levelId) =
            manager.createPosition(subId, start, path, spec, level)

        val a = create("2018-01-10").body<CareerPositionResponse>()
        val b = create("2020-01-10", path = pathB).body<CareerPositionResponse>()
        val c = create("2022-01-10", path = pathC).body<CareerPositionResponse>()

        // Appends must come strictly after the latest start (equal included).
        assertEquals(HttpStatusCode.Conflict, create("2022-01-10").status)
        assertEquals(HttpStatusCode.Conflict, create("2021-01-01").status)

        // A correction must keep the row between its neighbors (strictly); each row keeps
        // its own path, so only the date rule is in play here.
        suspend fun correct(positionId: UInt, start: String, path: UInt): HttpStatusCode =
            manager.put("/api/v1/users/$subId/career-positions/$positionId") {
                contentType(ContentType.Application.Json)
                setBody(CareerPositionWrite(start, path, specId, levelId))
            }.status
        assertEquals(HttpStatusCode.NoContent, correct(b.id, "2019-07-01", pathB))
        assertEquals(HttpStatusCode.Conflict, correct(b.id, "2018-01-10", pathB))
        assertEquals(HttpStatusCode.Conflict, correct(b.id, "2017-12-31", pathB))
        assertEquals(HttpStatusCode.Conflict, correct(b.id, "2022-01-10", pathB))
        assertEquals(HttpStatusCode.Conflict, correct(b.id, "2023-01-01", pathB))
        // The LAST row has no next neighbor — any date after its predecessor works (not future).
        assertEquals(HttpStatusCode.NoContent, correct(c.id, "2021-11-11", pathC))
        // The FIRST row has no previous neighbor — it may move arbitrarily far back.
        assertEquals(HttpStatusCode.NoContent, correct(a.id, "2015-01-01", pathA))

        // Shape 400s: malformed/unpadded/future dates, any missing triple field, bad refs.
        assertEquals(HttpStatusCode.BadRequest, create("2023-1-05").status)
        assertEquals(HttpStatusCode.BadRequest, create("not-a-date").status)
        assertEquals(HttpStatusCode.BadRequest, create("2999-01-01").status)
        assertEquals(HttpStatusCode.BadRequest, create("2023-05-05", path = null).status)
        assertEquals(HttpStatusCode.BadRequest, create("2023-05-05", spec = null).status)
        assertEquals(HttpStatusCode.BadRequest, create("2023-05-05", level = null).status)
        assertEquals(HttpStatusCode.BadRequest, create("2023-05-05", path = specId).status) // wrong dictionary
        assertEquals(HttpStatusCode.BadRequest, create("2023-05-05", path = 999_999_999u).status)
    }

    @Test
    fun `adjacent sameness - a position must differ from its neighbors`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("cps-m")
        val subEmail = uniqueEmail("cps-s")
        val mgrId = TestUsers.seed(mgrEmail, "pw", roles = emptySet())
        val subId = TestUsers.seed(subEmail, "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "cps-${UUID.randomUUID()}", managerId = mgrId))
        TestServices.teams.addMember(teamId, subId)
        val manager = authedClient(mgrEmail, "pw")

        val marker = UUID.randomUUID().toString().take(8)
        val (pathA, pathB, pathC) = TestDictionaries.append(
            Dictionary.CAREER_PATH, "CpS A $marker", "CpS B $marker", "CpS C $marker",
        )
        val (specId, levelId) = specAndLevel(marker)
        suspend fun correct(positionId: UInt, start: String, path: UInt): HttpStatusCode =
            manager.put("/api/v1/users/$subId/career-positions/$positionId") {
                contentType(ContentType.Application.Json)
                setBody(CareerPositionWrite(start, path, specId, levelId))
            }.status

        val a = manager.createPosition(subId, "2018-03-01", pathA, specId, levelId)
            .body<CareerPositionResponse>()
        // Appending the exact same triple is 409 — a repeat is not a step…
        assertEquals(
            HttpStatusCode.Conflict,
            manager.createPosition(subId, "2020-03-01", pathA, specId, levelId).status,
        )
        // …while changing ANY one field makes it a position again.
        val b = manager.createPosition(subId, "2020-03-01", pathB, specId, levelId)
            .body<CareerPositionResponse>()
        val c = manager.createPosition(subId, "2022-03-01", pathC, specId, levelId)
            .body<CareerPositionResponse>()

        // A correction may not make the row identical to its PREDECESSOR (b → a's triple)…
        assertEquals(HttpStatusCode.Conflict, correct(b.id, "2020-03-01", pathA))
        // …nor to its SUCCESSOR (b → c's triple; that would make c the meaningless repeat)…
        assertEquals(HttpStatusCode.Conflict, correct(b.id, "2020-03-01", pathC))
        // …but a date-only correction (own triple kept, differing from both neighbors) is fine,
        // and so is the FIRST row matching the LAST (they are not adjacent).
        assertEquals(HttpStatusCode.NoContent, correct(b.id, "2020-06-01", pathB))
        assertEquals(HttpStatusCode.NoContent, correct(a.id, "2018-03-01", pathC))
        assertEquals(listOf(pathC, pathB, pathC), manager.listPositions(subId).map { it.careerPath?.id })
        assertTrue(c.id > 0u)
    }

    @Test
    fun `the guard matrix - transitive-chain writes, open reads, rights follow the current chain`() =
        testApplication {
            usePostgresTestcontainer()
            // G manages Y {M}; M manages X {S, T}.
            val gEmail = uniqueEmail("cpz-g")
            val mEmail = uniqueEmail("cpz-m")
            val sEmail = uniqueEmail("cpz-s")
            val tEmail = uniqueEmail("cpz-t")
            val uEmail = uniqueEmail("cpz-u")
            val aEmail = uniqueEmail("cpz-a")
            val hEmail = uniqueEmail("cpz-h")
            val gId = TestUsers.seed(gEmail, "pw", roles = emptySet())
            val mId = TestUsers.seed(mEmail, "pw", roles = emptySet())
            val sId = TestUsers.seed(sEmail, "pw", roles = emptySet())
            val tId = TestUsers.seed(tEmail, "pw", roles = emptySet())
            TestUsers.seed(uEmail, "pw", roles = emptySet())
            TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
            TestUsers.seed(hEmail, "pw", roles = setOf(UserRole.HR))
            val teamY = TestServices.teams.create(Team(name = "cpzY-${UUID.randomUUID()}", managerId = gId))
            TestServices.teams.addMember(teamY, mId)
            val teamX = TestServices.teams.create(Team(name = "cpzX-${UUID.randomUUID()}", managerId = mId))
            TestServices.teams.addMember(teamX, sId)
            TestServices.teams.addMember(teamX, tId)

            val g = authedClient(gEmail, "pw")
            val m = authedClient(mEmail, "pw")
            val s = authedClient(sEmail, "pw")
            val t = authedClient(tEmail, "pw")
            val u = authedClient(uEmail, "pw")
            val a = authedClient(aEmail, "pw")
            val h = authedClient(hEmail, "pw")

            val marker = UUID.randomUUID().toString().take(8)
            val (pathId, pathId2) = TestDictionaries.append(Dictionary.CAREER_PATH, "CpZ $marker", "CpZ2 $marker")
            val (specId, levelId) = specAndLevel(marker)
            suspend fun create(client: HttpClient, start: String, path: UInt = pathId) =
                client.createPosition(sId, start, path, specId, levelId)

            // Writes: the direct manager AND the chain above — nobody else (ADMIN and HR
            // deliberately included in the 403 set; the write is the chain's alone). The
            // second create switches path — a repeat triple would be the sameness 409.
            assertEquals(HttpStatusCode.Created, create(m, "2016-01-01").status)
            assertEquals(HttpStatusCode.Created, create(g, "2017-01-01", path = pathId2).status)
            assertEquals(HttpStatusCode.Forbidden, create(s, "2018-01-01").status)
            assertEquals(HttpStatusCode.Forbidden, create(t, "2018-01-01").status)
            assertEquals(HttpStatusCode.Forbidden, create(u, "2018-01-01").status)
            assertEquals(HttpStatusCode.Forbidden, create(a, "2018-01-01").status)
            assertEquals(HttpStatusCode.Forbidden, create(h, "2018-01-01").status)
            // The 403 is uniform for an unknown target too (guard before read on POST).
            assertEquals(
                HttpStatusCode.Forbidden,
                u.createPosition(999_999_999u, "2018-01-01", pathId, specId, levelId).status,
            )

            // Reads: ANY authenticated caller — teammates, unrelated, ADMIN, HR alike.
            for (client in listOf(s, t, u, a, h, g, m)) {
                assertEquals(HttpStatusCode.OK, client.get("/api/v1/users/$sId/career-positions").status)
            }

            // Rights follow the CURRENT chain: after team X moves under G directly, M is out.
            val positionId = m.listPositions(sId).first().id
            TestServices.teams.update(
                teamX,
                Team(name = "cpzX2-${UUID.randomUUID()}", managerId = gId, memberIds = listOf(sId, tId)),
            )
            assertEquals(
                HttpStatusCode.Forbidden,
                m.put("/api/v1/users/$sId/career-positions/$positionId") {
                    contentType(ContentType.Application.Json)
                    setBody(CareerPositionWrite("2015-06-01", pathId, specId, levelId))
                }.status,
            )
            assertEquals(HttpStatusCode.Forbidden, create(m, "2019-01-01").status)
            assertEquals(HttpStatusCode.NoContent, g.delete("/api/v1/users/$sId/career-positions/$positionId").status)
        }

    @Test
    fun `dictionary refs - renames propagate, soft-deleted refs keep resolving, changed refs validate`() =
        testApplication {
            usePostgresTestcontainer()
            val mgrEmail = uniqueEmail("cpd-m")
            val subEmail = uniqueEmail("cpd-s")
            val mgrId = TestUsers.seed(mgrEmail, "pw", roles = emptySet())
            val subId = TestUsers.seed(subEmail, "pw", roles = emptySet())
            val teamId = TestServices.teams.create(Team(name = "cpd-${UUID.randomUUID()}", managerId = mgrId))
            TestServices.teams.addMember(teamId, subId)
            val manager = authedClient(mgrEmail, "pw")

            val marker = UUID.randomUUID().toString().take(8)
            val (pathId) = TestDictionaries.append(Dictionary.CAREER_PATH, "CpD $marker")
            val (specId, levelId) = specAndLevel(marker)
            val (deadId) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "CpDead $marker")

            val position = manager.createPosition(subId, "2019-09-01", pathId, specId, levelId)
                .body<CareerPositionResponse>()

            // Renames propagate to the timeline and the derived user triple alike.
            TestDictionaries.rename(Dictionary.CAREER_PATH, pathId, "CpD2 $marker")
            assertEquals(
                DictionaryEntry(pathId, "CpD2 $marker", "CpD2 $marker"),
                manager.listPositions(subId).single().careerPath,
            )

            // A soft-deleted referenced entry keeps resolving, and a correction resubmitting it
            // (a date-only fix) is NOT a change — no 400 on the stale ref.
            TestDictionaries.remove(Dictionary.CAREER_PATH, pathId)
            assertEquals(
                DictionaryEntry(pathId, "CpD2 $marker", "CpD2 $marker"),
                manager.listPositions(subId).single().careerPath,
            )
            assertEquals(
                HttpStatusCode.NoContent,
                manager.put("/api/v1/users/$subId/career-positions/${position.id}") {
                    contentType(ContentType.Application.Json)
                    setBody(CareerPositionWrite("2019-10-01", pathId, specId, levelId))
                }.status,
            )

            // But CHANGING a ref to a soft-deleted entry is 400.
            TestDictionaries.remove(Dictionary.SENIORITY_LEVEL, deadId)
            assertEquals(
                HttpStatusCode.BadRequest,
                manager.put("/api/v1/users/$subId/career-positions/${position.id}") {
                    contentType(ContentType.Application.Json)
                    setBody(CareerPositionWrite("2019-10-01", pathId, specId, deadId))
                }.status,
            )
        }

    @Test
    fun `the user is notified on a new position only - corrections and deletes stay silent`() =
        testApplication {
            usePostgresTestcontainer()
            val mgrEmail = uniqueEmail("cpn-m")
            val subEmail = uniqueEmail("cpn-s")
            val mgrId = TestUsers.seed(mgrEmail, "pw", name = "CpN Mgr", roles = emptySet())
            val subId = TestUsers.seed(subEmail, "pw", roles = emptySet())
            val teamId = TestServices.teams.create(Team(name = "cpn-${UUID.randomUUID()}", managerId = mgrId))
            TestServices.teams.addMember(teamId, subId)
            val manager = authedClient(mgrEmail, "pw")
            val sub = authedClient(subEmail, "pw")

            val marker = UUID.randomUUID().toString().take(8)
            val (pathId, pathId2) = TestDictionaries.append(Dictionary.CAREER_PATH, "CpN $marker", "CpN2 $marker")
            val (specId, levelId) = specAndLevel(marker)

            val position = manager.createPosition(subId, "2020-04-01", pathId, specId, levelId)
                .body<CareerPositionResponse>()
            manager.put("/api/v1/users/$subId/career-positions/${position.id}") {
                contentType(ContentType.Application.Json)
                setBody(CareerPositionWrite("2020-05-01", pathId, specId, levelId))
            }.let { assertEquals(HttpStatusCode.NoContent, it.status) }
            val second = manager.createPosition(subId, "2021-04-01", pathId2, specId, levelId)
                .body<CareerPositionResponse>()
            manager.delete("/api/v1/users/$subId/career-positions/${second.id}")
                .let { assertEquals(HttpStatusCode.NoContent, it.status) }

            val notes = sub.get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>()
                .items.filter { it.type == NotificationType.CAREER_POSITION_STARTED_TO_USER }
            assertEquals(2, notes.size) // one per CREATE — nothing for the correction or delete
            val first = notes.single { it.params["startDate"] == "2020-04-01" }
            assertEquals("CpN Mgr", first.params["manager"])
            assertEquals("/users/$subId/career", first.link)
            assertNotNull(notes.single { it.params["startDate"] == "2021-04-01" })
            assertTrue(position.id > 0u)
        }
}
