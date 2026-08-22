package ch.nokillswit

import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamPageResponse
import ch.nokillswit.teams.TeamResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TeamRoutesTest {


    @Test
    fun `create + read round-trip`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("b"), password = "pw")

        val client = authedClient(managerEmail, "pw")
        val createResponse = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Platform", managerId = managerId, memberIds = listOf(memberA, memberB)))
        }
        assertEquals(HttpStatusCode.Created, createResponse.status)
        val created = createResponse.body<TeamResponse>()
        assertEquals("Platform", created.name)
        assertEquals(managerId, created.managerId)
        assertEquals(listOf(memberA, memberB), created.memberIds)
        val location = createResponse.headers[HttpHeaders.Location]
        assertNotNull(location)
        assertTrue(location.endsWith("/api/v1/teams/${created.id}"), "Location was $location")

        val readResponse = client.get("/api/v1/teams/${created.id}")
        assertEquals(HttpStatusCode.OK, readResponse.status)
        val read = readResponse.body<TeamResponse>()
        // The single-team GET additionally enriches the manager fields (create omits them).
        assertEquals(created, read.copy(managerName = null, managerDeleted = null))
        assertEquals("Test", read.managerName)
        assertEquals(false, read.managerDeleted)
        // The creator named themselves manager, so the capability rides both responses.
        assertTrue(created.canManageKpis)
        assertTrue(read.canManageKpis)
    }

    @Test
    fun `canManageKpis marks the manager and the chain above - nobody else`() = testApplication {
        usePostgresTestcontainer()
        // G manages Y {M}; M manages X {S}. U unrelated, A a chain-less admin.
        val gEmail = uniqueEmail("kpicap-g")
        val mEmail = uniqueEmail("kpicap-m")
        val sEmail = uniqueEmail("kpicap-s")
        val uEmail = uniqueEmail("kpicap-u")
        val aEmail = uniqueEmail("kpicap-a")
        val gId = TestUsers.seed(gEmail, "pw", roles = emptySet())
        val mId = TestUsers.seed(mEmail, "pw", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", roles = emptySet())
        TestUsers.seed(uEmail, "pw", roles = emptySet())
        TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
        val teamY = TestServices.teams.create(Team(name = "kpicapY-${UUID.randomUUID()}", managerId = gId))
        TestServices.teams.addMember(teamY, mId)
        val teamX = TestServices.teams.create(Team(name = "kpicapX-${UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamX, sId)

        suspend fun canManage(email: String): Boolean =
            authedClient(email, "pw").get("/api/v1/teams/$teamX").body<TeamResponse>().canManageKpis

        // The capability (v2.34.0) = the TeamKpi manage predicate: manager + chain above;
        // a member, an unrelated user, and a chain-less ADMIN all read the team but get false.
        assertTrue(canManage(mEmail))
        assertTrue(canManage(gEmail))
        assertFalse(canManage(sEmail))
        assertFalse(canManage(uEmail))
        assertFalse(canManage(aEmail))
    }

    @Test
    fun `single-team GET enriches manager fields, create and update omit the keys`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw", name = "Enrich Manager")
        val adminEmail = uniqueEmail("adm")
        TestUsers.seed(email = adminEmail, password = "pw")

        val client = authedClient(managerEmail, "pw")
        val createResponse = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Enriched", managerId = managerId))
        }
        assertEquals(HttpStatusCode.Created, createResponse.status)
        val createText = createResponse.bodyAsText()
        assertFalse(createText.contains("managerName"), "create must omit the enrichment: $createText")
        val teamId = Json.decodeFromString<TeamResponse>(createText).id

        val read = client.get("/api/v1/teams/$teamId").body<TeamResponse>()
        assertEquals("Enrich Manager", read.managerName)
        assertEquals(false, read.managerDeleted)

        // PUT answers a bodiless 204, so create is the only sibling emitting TeamResponse.
        val putResponse = client.put("/api/v1/teams/$teamId") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Enriched Still", managerId = managerId))
        }
        assertEquals(HttpStatusCode.NoContent, putResponse.status)

        // A soft-deleted manager still resolves — with the flag set (the teams-list rule).
        val admin = authedClient(adminEmail, "pw")
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$managerId").status)
        val readDeleted = admin.get("/api/v1/teams/$teamId").body<TeamResponse>()
        assertEquals("Enrich Manager", readDeleted.managerName)
        assertEquals(true, readDeleted.managerDeleted)
    }

    @Test
    fun `manager cannot be a standard member`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = email, password = "pw")

        val client = authedClient(email, "pw")
        val response = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Bad", managerId = managerId, memberIds = listOf(managerId)))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `mutating a soft-deleted team is 404`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = email, password = "pw")
        val memberId = TestUsers.seed(email = uniqueEmail("m"), password = "pw")

        val client = authedClient(email, "pw")
        val teamId = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Doomed", managerId = managerId, memberIds = listOf(memberId)))
        }.body<TeamResponse>().id
        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/teams/$teamId").status)

        val putResponse = client.put("/api/v1/teams/$teamId") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Zombie", managerId = managerId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.NotFound, putResponse.status)
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/teams/$teamId").status)
        assertEquals(HttpStatusCode.NotFound, client.put("/api/v1/teams/$teamId/members/$memberId").status)
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/teams/$teamId/members/$memberId").status)
    }

    @Test
    fun `POST teams accepts an empty member list`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = email, password = "pw")

        val client = authedClient(email, "pw")
        val response = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Empty", managerId = managerId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<TeamResponse>()
        assertTrue(created.memberIds.isEmpty())

        val read = client.get("/api/v1/teams/${created.id}").body<TeamResponse>()
        assertTrue(read.memberIds.isEmpty())
    }

    @Test
    fun `POST teams with only name and managerId succeeds`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = email, password = "pw")

        val client = authedClient(email, "pw")
        // Body deliberately omits memberIds to exercise the Kotlin default.
        val response = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("name", "Minimal")
                put("managerId", managerId.toLong())
            })
        }
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<TeamResponse>()
        assertEquals("Minimal", created.name)
        assertEquals(managerId, created.managerId)
        assertTrue(created.memberIds.isEmpty())
    }

    @Test
    fun `member sub-resource adds and removes members`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("b"), password = "pw")
        val memberC = TestUsers.seed(email = uniqueEmail("c"), password = "pw")

        val client = authedClient(managerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA, memberB)))
        }.body<TeamResponse>()

        val addResponse = client.put("/api/v1/teams/${team.id}/members/$memberC")
        assertEquals(HttpStatusCode.NoContent, addResponse.status)
        val afterAdd = client.get("/api/v1/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberA, memberB, memberC).sorted(), afterAdd.memberIds.sorted())

        val removeResponse = client.delete("/api/v1/teams/${team.id}/members/$memberA")
        assertEquals(HttpStatusCode.NoContent, removeResponse.status)
        val afterRemove = client.get("/api/v1/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberB, memberC).sorted(), afterRemove.memberIds.sorted())

        client.delete("/api/v1/teams/${team.id}/members/$memberB")
        val lastRemoveResponse = client.delete("/api/v1/teams/${team.id}/members/$memberC")
        assertEquals(HttpStatusCode.NoContent, lastRemoveResponse.status)
        val afterAll = client.get("/api/v1/teams/${team.id}").body<TeamResponse>()
        assertTrue(afterAll.memberIds.isEmpty())
    }

    @Test
    fun `adding manager as member via sub-resource is rejected`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(managerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val response = client.put("/api/v1/teams/${team.id}/members/$managerId")
        assertEquals(HttpStatusCode.BadRequest, response.status, response.bodyAsText())
    }

    @Test
    fun `update replaces name, manager, and members`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val mgr1 = TestUsers.seed(email = ownerEmail, password = "pw")
        val mgr2 = TestUsers.seed(email = uniqueEmail("mgr2"), password = "pw")
        val m1 = TestUsers.seed(email = uniqueEmail("m1"), password = "pw")
        val m2 = TestUsers.seed(email = uniqueEmail("m2"), password = "pw")
        val m3 = TestUsers.seed(email = uniqueEmail("m3"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Before", managerId = mgr1, memberIds = listOf(m1, m2)))
        }.body<TeamResponse>()

        val updateResponse = client.put("/api/v1/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "After", managerId = mgr2, memberIds = listOf(m2, m3)))
        }
        assertEquals(HttpStatusCode.NoContent, updateResponse.status)

        val after = client.get("/api/v1/teams/${team.id}").body<TeamResponse>()
        assertEquals("After", after.name)
        assertEquals(mgr2, after.managerId)
        assertEquals(listOf(m2, m3).sorted(), after.memberIds.sorted())
    }

    @Test
    fun `PUT teams accepts an empty member list`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val response = client.put("/api/v1/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.NoContent, response.status)

        val after = client.get("/api/v1/teams/${team.id}").body<TeamResponse>()
        assertTrue(after.memberIds.isEmpty())
    }

    @Test
    fun `update with manager in members is rejected`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val response = client.put("/api/v1/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(managerId, memberA)))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `update with duplicate members is rejected`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("b"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val response = client.put("/api/v1/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA, memberA, memberB)))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `delete removes the team and subsequent GET returns 404`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val deleteResponse = client.delete("/api/v1/teams/${team.id}")
        assertEquals(HttpStatusCode.NoContent, deleteResponse.status)

        val getResponse = client.get("/api/v1/teams/${team.id}")
        assertEquals(HttpStatusCode.NotFound, getResponse.status)
    }

    @Test
    fun `get for nonexistent team returns 404`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        TestUsers.seed(email = ownerEmail, password = "pw")
        val client = authedClient(ownerEmail, "pw")

        val response = client.get("/api/v1/teams/999999")
        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    @Test
    fun `delete of a non-existent team returns 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw") // ADMIN by default
        val client = authedClient(adminEmail, "pw")

        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/teams/999999").status)
    }

    @Test
    fun `create with duplicate memberIds is rejected`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val response = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Dup", managerId = managerId, memberIds = listOf(memberA, memberA)))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `team endpoints require authentication`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val endpoints = listOf(
            HttpMethod.Post to "/api/v1/teams",
            HttpMethod.Get to "/api/v1/teams/1",
            HttpMethod.Put to "/api/v1/teams/1",
            HttpMethod.Delete to "/api/v1/teams/1",
            HttpMethod.Put to "/api/v1/teams/1/members/2",
            HttpMethod.Delete to "/api/v1/teams/1/members/2",
        )
        for ((verb, path) in endpoints) {
            val response = client.request(path) { method = verb }
            assertEquals(
                HttpStatusCode.Unauthorized,
                response.status,
                "$verb $path expected 401, got ${response.status}",
            )
        }
    }

    @Test
    fun `re-adding an existing member is a no-op`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val first = client.put("/api/v1/teams/${team.id}/members/$memberA")
        assertEquals(HttpStatusCode.NoContent, first.status)
        val second = client.put("/api/v1/teams/${team.id}/members/$memberA")
        assertEquals(HttpStatusCode.NoContent, second.status)

        val after = client.get("/api/v1/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberA), after.memberIds)
    }

    @Test
    fun `removing a user who is not a member is a no-op`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val outsider = TestUsers.seed(email = uniqueEmail("outsider"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        // Deleting a non-member succeeds without touching the membership (idempotent DELETE).
        val response = client.delete("/api/v1/teams/${team.id}/members/$outsider")
        assertEquals(HttpStatusCode.NoContent, response.status)

        val after = client.get("/api/v1/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberA), after.memberIds)
    }

    @Test
    fun `soft-deleting a member user preserves the membership row`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("b"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA, memberB)))
        }.body<TeamResponse>()

        val deleteUser = client.delete("/api/v1/users/$memberA")
        assertEquals(HttpStatusCode.NoContent, deleteUser.status)

        val after = client.get("/api/v1/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberA, memberB).sorted(), after.memberIds.sorted())
    }

    @Test
    fun `soft-deleting a team manager preserves the team`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/users/$managerId").status)

        val after = client.get("/api/v1/teams/${team.id}").body<TeamResponse>()
        assertEquals(managerId, after.managerId)
    }

    @Test
    fun `GET teams returns paginated envelope with manager names`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw", name = "Mona")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(managerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        repeat(3) { i ->
            client.post("/api/v1/teams") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "list-$tag-$i", managerId = managerId, memberIds = listOf(memberA)))
            }
        }

        val response = client.get("/api/v1/teams?name=list-$tag")
        assertEquals(HttpStatusCode.OK, response.status)
        val page = response.body<TeamPageResponse>()
        assertEquals(1, page.page)
        assertEquals(20, page.pageSize)
        assertEquals(3L, page.total)
        assertEquals(3, page.items.size)
        assertTrue(page.items.all { it.managerId == managerId })
        assertTrue(page.items.all { it.managerName == "Mona" })
        assertTrue(page.items.all { !it.managerDeleted })
    }

    @Test
    fun `GET teams name filter is diacritics-insensitive`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")

        val client = authedClient(managerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Zespół-$tag", managerId = managerId, memberIds = emptyList()))
        }

        // Plain ASCII query matches the stored Polish name (cross-service proof that the
        // shared containsNormalized helper is wired beyond the users list).
        val page = client.get("/api/v1/teams") { parameter("name", "zespol-$tag") }.body<TeamPageResponse>()
        assertEquals(1L, page.total)
        assertEquals("Zespół-$tag", page.items.single().name)
    }

    @Test
    fun `GET teams marks managers that have been soft-deleted`() = testApplication {
        usePostgresTestcontainer()
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val adminEmail = uniqueEmail("admin-$tag")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN), name = "Admin-$tag")
        val doomedEmail = uniqueEmail("doomed-$tag")
        val doomedId = TestUsers.seed(email = doomedEmail, password = "pw", name = "Doomed-$tag")
        val survivorEmail = uniqueEmail("alive-$tag")
        val survivorId = TestUsers.seed(email = survivorEmail, password = "pw", name = "Alive-$tag")
        val memberA = TestUsers.seed(email = uniqueEmail("m-$tag"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        admin.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "team-doomed-$tag", managerId = doomedId, memberIds = listOf(memberA)))
        }
        admin.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "team-alive-$tag", managerId = survivorId, memberIds = listOf(memberA)))
        }

        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$doomedId").status)

        val page = admin.get("/api/v1/teams?name=team-").body<TeamPageResponse>()
        val itemsByName = page.items.associateBy { it.name }
        val doomedTeam = itemsByName["team-doomed-$tag"]
        val aliveTeam = itemsByName["team-alive-$tag"]
        assertEquals("Doomed-$tag", doomedTeam?.managerName)
        assertEquals(true, doomedTeam?.managerDeleted)
        assertEquals("Alive-$tag", aliveTeam?.managerName)
        assertEquals(false, aliveTeam?.managerDeleted)
    }

    @Test
    fun `GET teams supports filter by managerId`() = testApplication {
        usePostgresTestcontainer()
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val ownerEmail = uniqueEmail("owner-$tag")
        val ownerId = TestUsers.seed(email = ownerEmail, password = "pw", name = "Owner-$tag")
        val otherMgrEmail = uniqueEmail("other-$tag")
        val otherMgrId = TestUsers.seed(email = otherMgrEmail, password = "pw", name = "Other-$tag")
        val memberA = TestUsers.seed(email = uniqueEmail("m-$tag"), password = "pw")

        val ownerClient = authedClient(ownerEmail, "pw")
        ownerClient.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "owned-$tag", managerId = ownerId, memberIds = listOf(memberA)))
        }
        val otherClient = authedClient(otherMgrEmail, "pw")
        otherClient.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "other-$tag", managerId = otherMgrId, memberIds = listOf(memberA)))
        }

        val page = ownerClient.get("/api/v1/teams?name=$tag&managerId=$ownerId").body<TeamPageResponse>()
        assertEquals(1L, page.total)
        assertEquals("owned-$tag", page.items.single().name)
        assertEquals(ownerId, page.items.single().managerId)
    }

    @Test
    fun `includeIndirect widens the managerId filter to the subtree and requires it`() = testApplication {
        usePostgresTestcontainer()
        // G manages "upper" {M}; M manages "lower". G's subtree = both teams (v2.26.0 —
        // backs the KPI create picker).
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val grandEmail = uniqueEmail("g-$tag")
        val grandId = TestUsers.seed(grandEmail, "pw", name = "Grand-$tag", roles = emptySet())
        val midId = TestUsers.seed(uniqueEmail("m-$tag"), "pw", name = "Mid-$tag", roles = emptySet())
        TestServices.teams.create(Team(name = "upper-$tag", managerId = grandId, memberIds = listOf(midId)))
        TestServices.teams.create(Team(name = "lower-$tag", managerId = midId))

        val grand = authedClient(grandEmail, "pw")
        val direct = grand.get("/api/v1/teams?name=$tag&managerId=$grandId").body<TeamPageResponse>()
        assertEquals(listOf("upper-$tag"), direct.items.map { it.name })
        val wide = grand.get("/api/v1/teams?name=$tag&managerId=$grandId&includeIndirect=true&sort=name")
            .body<TeamPageResponse>()
        assertEquals(listOf("lower-$tag", "upper-$tag"), wide.items.map { it.name })
        // A lone flag without managerId is a clean 400 (nothing to widen).
        assertEquals(
            HttpStatusCode.BadRequest,
            grand.get("/api/v1/teams?includeIndirect=true").status,
        )
    }

    @Test
    fun `GET teams supports filter by memberId`() = testApplication {
        usePostgresTestcontainer()
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val adminEmail = uniqueEmail("admin-$tag")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN), name = "Admin-$tag")
        val managerId = TestUsers.seed(email = uniqueEmail("mgr-$tag"), password = "pw", name = "Mgr-$tag")
        val target = TestUsers.seed(email = uniqueEmail("target-$tag"), password = "pw", name = "Target-$tag")
        val other = TestUsers.seed(email = uniqueEmail("other-$tag"), password = "pw", name = "Other-$tag")

        val admin = authedClient(adminEmail, "pw")
        // target IS a member here
        val memberTeam = admin.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "member-$tag", managerId = managerId, memberIds = listOf(target, other)))
        }.body<TeamResponse>()
        // target is NOT a member here
        admin.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "nonmember-$tag", managerId = managerId, memberIds = listOf(other)))
        }
        // target is the MANAGER here, not a member -> must be excluded by memberId filter
        admin.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "managed-$tag", managerId = target, memberIds = listOf(other)))
        }

        val page = admin.get("/api/v1/teams?name=$tag&memberId=$target").body<TeamPageResponse>()
        assertEquals(1L, page.total)
        assertEquals("member-$tag", page.items.single().name)
        assertEquals(memberTeam.id, page.items.single().id)
    }

    @Test
    fun `GET teams with non-numeric memberId returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        TestUsers.seed(email = managerEmail, password = "pw")
        val response = authedClient(managerEmail, "pw").get("/api/v1/teams?memberId=abc")
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `GET teams supports sort by name descending`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val client = authedClient(managerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        listOf("bravo", "alpha", "charlie").forEach { stem ->
            client.post("/api/v1/teams") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "sort-$tag-$stem", managerId = managerId, memberIds = listOf(memberA)))
            }
        }

        val page = client.get("/api/v1/teams?name=sort-$tag&sort=-name").body<TeamPageResponse>()
        assertEquals(
            listOf("sort-$tag-charlie", "sort-$tag-bravo", "sort-$tag-alpha"),
            page.items.map { it.name },
        )
    }

    @Test
    fun `GET teams paginates correctly`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val client = authedClient(managerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        repeat(5) { i ->
            client.post("/api/v1/teams") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "page-$tag-$i", managerId = managerId, memberIds = listOf(memberA)))
            }
        }

        val pageOne = client.get("/api/v1/teams?name=page-$tag&sort=name&page=1&pageSize=2").body<TeamPageResponse>()
        assertEquals(5L, pageOne.total)
        assertEquals(listOf("page-$tag-0", "page-$tag-1"), pageOne.items.map { it.name })

        val pageTwo = client.get("/api/v1/teams?name=page-$tag&sort=name&page=2&pageSize=2").body<TeamPageResponse>()
        assertEquals(listOf("page-$tag-2", "page-$tag-3"), pageTwo.items.map { it.name })

        val pageThree = client.get("/api/v1/teams?name=page-$tag&sort=name&page=3&pageSize=2").body<TeamPageResponse>()
        assertEquals(listOf("page-$tag-4"), pageThree.items.map { it.name })
    }

    @Test
    fun `GET teams with unknown sort field returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        TestUsers.seed(email = managerEmail, password = "pw")
        val response = authedClient(managerEmail, "pw").get("/api/v1/teams?sort=manager_id")
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals(HttpStatusCode.BadRequest.value, response.body<ProblemDetail>().status)
    }

    @Test
    fun `GET teams with non-numeric managerId returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        TestUsers.seed(email = managerEmail, password = "pw")
        val response = authedClient(managerEmail, "pw").get("/api/v1/teams?managerId=abc")
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `GET teams without authentication returns 401`() = testApplication {
        usePostgresTestcontainer()
        val response = jsonClient().get("/api/v1/teams")
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `DELETE teams id hides the team from listings`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val client = authedClient(managerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val keeper = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "keep-$tag", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()
        val doomed = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "drop-$tag", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val before = client.get("/api/v1/teams?name=$tag").body<TeamPageResponse>()
        assertEquals(2L, before.total)

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/teams/${doomed.id}").status)

        val after = client.get("/api/v1/teams?name=$tag").body<TeamPageResponse>()
        assertEquals(1L, after.total)
        assertEquals(keeper.id, after.items.single().id)

        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/teams/${doomed.id}").status)
    }

    @Test
    fun `PUT teams id on a soft-deleted team returns 404`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val client = authedClient(managerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Ephemeral", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/teams/${team.id}").status)

        val put = client.put("/api/v1/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Resurrected", managerId = managerId, memberIds = listOf(memberA)))
        }
        assertEquals(HttpStatusCode.NotFound, put.status)
    }

    @Test
    fun `Member sub-resource on a soft-deleted team returns 404`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("b"), password = "pw")
        val client = authedClient(managerEmail, "pw")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Ghost", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/teams/${team.id}").status)

        val addAfter = client.put("/api/v1/teams/${team.id}/members/$memberB")
        assertEquals(HttpStatusCode.NotFound, addAfter.status)
    }

    @Test
    fun `POST teams with a non-existent manager returns 400`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw") // ADMIN may designate any manager
        val client = authedClient(adminEmail, "pw")

        val response = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Orphan", managerId = 999_999u, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals(HttpStatusCode.BadRequest.value, response.body<ProblemDetail>().status)
    }

    @Test
    fun `POST teams with a non-existent member returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val client = authedClient(managerEmail, "pw")

        val response = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Ghosts", managerId = managerId, memberIds = listOf(999_999u)))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `PUT teams with a non-existent manager returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val client = authedClient(managerEmail, "pw")

        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Platform", managerId = managerId, memberIds = emptyList()))
        }.body<TeamResponse>()

        val response = client.put("/api/v1/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Platform", managerId = 999_999u, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `adding a non-existent user as a member returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val client = authedClient(managerEmail, "pw")

        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Platform", managerId = managerId, memberIds = emptyList()))
        }.body<TeamResponse>()

        val response = client.put("/api/v1/teams/${team.id}/members/999999")
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }
}
