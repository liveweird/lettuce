package ch.nokillswit

import ch.nokillswit.alerts.Alert
import ch.nokillswit.alerts.AlertPageResponse
import ch.nokillswit.alerts.AlertResponse
import ch.nokillswit.alerts.VisibleAlertList
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

class AlertTest {

    private fun uniqueTitle(prefix: String) = "$prefix-${UUID.randomUUID()}"

    private suspend fun HttpClient.createAlert(alert: Alert): AlertResponse {
        val res = post("/api/v1/alerts") {
            contentType(ContentType.Application.Json)
            setBody(alert)
        }
        assertEquals(HttpStatusCode.Created, res.status, "seed create '${alert.title}'")
        return res.body<AlertResponse>()
    }

    private suspend fun HttpClient.visibleIds(): Set<UInt> =
        get("/api/v1/alerts/visible").body<VisibleAlertList>().items.map { it.id }.toSet()

    @Test
    fun `admin can create, read, list, update and delete an alert`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val title = uniqueTitle("maintenance")
        val created = client.post("/api/v1/alerts") {
            contentType(ContentType.Application.Json)
            setBody(Alert(title = title, content = "**Down** at 18:00", startsAt = 1000L, endsAt = 2000L))
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val body = created.body<AlertResponse>()
        assertEquals(title, body.title)
        assertEquals("**Down** at 18:00", body.content)
        assertTrue(body.isActive)
        assertEquals(1000L, body.startsAt)
        assertEquals(2000L, body.endsAt)
        assertEquals("/api/v1/alerts/${body.id}", created.headers[HttpHeaders.Location])

        val fetched = client.get("/api/v1/alerts/${body.id}")
        assertEquals(HttpStatusCode.OK, fetched.status)
        assertEquals(title, fetched.body<AlertResponse>().title)

        val listed = client.get("/api/v1/alerts?title=$title").body<AlertPageResponse>()
        assertEquals(1, listed.items.count { it.id == body.id })

        val updated = client.put("/api/v1/alerts/${body.id}") {
            contentType(ContentType.Application.Json)
            setBody(Alert(title = title, content = "Updated", isActive = false, startsAt = null, endsAt = null))
        }
        assertEquals(HttpStatusCode.NoContent, updated.status)
        val reFetched = client.get("/api/v1/alerts/${body.id}").body<AlertResponse>()
        assertEquals("Updated", reFetched.content)
        assertFalse(reFetched.isActive)
        assertEquals(null, reFetched.startsAt)
        assertEquals(null, reFetched.endsAt)

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/alerts/${body.id}").status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/alerts/${body.id}").status)
    }

    @Test
    fun `unauthenticated requests return 401`() = testApplication {
        usePostgresTestcontainer()
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/alerts").status)
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/alerts/visible").status)
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/alerts/1").status)
    }

    @Test
    fun `non-admin may read visible alerts but nothing else`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val userEmail = uniqueEmail("user")
        TestUsers.seed(email = userEmail, password = "pw", role = UserRole.USER)

        val adminClient = authedClient(adminEmail, "pw")
        val userClient = authedClient(userEmail, "pw")

        val created = adminClient.createAlert(Alert(title = uniqueTitle("shared"), content = "body"))

        // The banner endpoint is open to any authenticated user — and shows the alert.
        val visible = userClient.get("/api/v1/alerts/visible")
        assertEquals(HttpStatusCode.OK, visible.status)
        assertTrue(created.id in visible.body<VisibleAlertList>().items.map { it.id })

        // Management endpoints are ADMIN-only, reads included.
        assertEquals(HttpStatusCode.Forbidden, userClient.get("/api/v1/alerts").status)
        assertEquals(HttpStatusCode.Forbidden, userClient.get("/api/v1/alerts/${created.id}").status)
        assertEquals(
            HttpStatusCode.Forbidden,
            userClient.post("/api/v1/alerts") {
                contentType(ContentType.Application.Json)
                setBody(Alert(title = uniqueTitle("sneaky"), content = "x"))
            }.status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            userClient.put("/api/v1/alerts/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(Alert(title = "hijack", content = "x"))
            }.status,
        )
        assertEquals(HttpStatusCode.Forbidden, userClient.delete("/api/v1/alerts/${created.id}").status)
    }

    @Test
    fun `create and update reject invalid payloads`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        suspend fun createStatus(alert: Alert): HttpStatusCode = client.post("/api/v1/alerts") {
            contentType(ContentType.Application.Json)
            setBody(alert)
        }.status

        assertEquals(HttpStatusCode.BadRequest, createStatus(Alert(title = "   ", content = "x")))
        assertEquals(HttpStatusCode.BadRequest, createStatus(Alert(title = "t".repeat(151), content = "x")))
        assertEquals(HttpStatusCode.BadRequest, createStatus(Alert(title = "ok", content = "   ")))
        assertEquals(HttpStatusCode.BadRequest, createStatus(Alert(title = "ok", content = "")))
        assertEquals(HttpStatusCode.BadRequest, createStatus(Alert(title = "ok", content = "x".repeat(5001))))
        // start must be strictly before end.
        assertEquals(
            HttpStatusCode.BadRequest,
            createStatus(Alert(title = "ok", content = "x", startsAt = 2000L, endsAt = 1000L)),
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            createStatus(Alert(title = "ok", content = "x", startsAt = 1000L, endsAt = 1000L)),
        )

        val existing = client.createAlert(Alert(title = uniqueTitle("ok"), content = "x"))
        val put = client.put("/api/v1/alerts/${existing.id}") {
            contentType(ContentType.Application.Json)
            setBody(Alert(title = "   ", content = "x"))
        }
        assertEquals(HttpStatusCode.BadRequest, put.status)
    }

    @Test
    fun `list rejects malformed query parameters`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/alerts?page=0").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/alerts?pageSize=101").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/alerts?sort=content").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/alerts?isActive=maybe").status)
    }

    @Test
    fun `list filters by title and isActive, sorts and paginates`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val prefix = uniqueTitle("page")
        client.createAlert(Alert(title = "$prefix-a", content = "x", isActive = true))
        client.createAlert(Alert(title = "$prefix-b", content = "x", isActive = false))
        client.createAlert(Alert(title = "$prefix-c", content = "x", isActive = true))

        // Title substring filter is case-insensitive.
        val all = client.get("/api/v1/alerts?title=$prefix&sort=title").body<AlertPageResponse>()
        assertEquals(3, all.total)
        assertEquals(listOf("$prefix-a", "$prefix-b", "$prefix-c"), all.items.map { it.title })

        val actives = client.get("/api/v1/alerts?title=$prefix&isActive=true&sort=title").body<AlertPageResponse>()
        assertEquals(listOf("$prefix-a", "$prefix-c"), actives.items.map { it.title })

        val inactive = client.get("/api/v1/alerts?title=$prefix&isActive=false").body<AlertPageResponse>()
        assertEquals(listOf("$prefix-b"), inactive.items.map { it.title })

        val desc = client.get("/api/v1/alerts?title=$prefix&sort=-title&page=1&pageSize=2").body<AlertPageResponse>()
        assertEquals(3, desc.total)
        assertEquals(listOf("$prefix-c", "$prefix-b"), desc.items.map { it.title })
        val page2 = client.get("/api/v1/alerts?title=$prefix&sort=-title&page=2&pageSize=2").body<AlertPageResponse>()
        assertEquals(listOf("$prefix-a"), page2.items.map { it.title })
    }

    @Test
    fun `visible returns only active alerts inside their window`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val now = System.currentTimeMillis()
        val hour = 3_600_000L

        val unbounded = client.createAlert(Alert(title = uniqueTitle("unbounded"), content = "x"))
        val inWindow = client.createAlert(
            Alert(title = uniqueTitle("in-window"), content = "x", startsAt = now - hour, endsAt = now + hour),
        )
        val startedOnly = client.createAlert(Alert(title = uniqueTitle("started"), content = "x", startsAt = now - hour))
        val endingOnly = client.createAlert(Alert(title = uniqueTitle("ending"), content = "x", endsAt = now + hour))
        val inactive = client.createAlert(Alert(title = uniqueTitle("inactive"), content = "x", isActive = false))
        val future = client.createAlert(Alert(title = uniqueTitle("future"), content = "x", startsAt = now + hour))
        val expired = client.createAlert(Alert(title = uniqueTitle("expired"), content = "x", endsAt = now - hour))
        val deleted = client.createAlert(Alert(title = uniqueTitle("deleted"), content = "x"))
        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/alerts/${deleted.id}").status)

        val visible = client.visibleIds()
        assertTrue(unbounded.id in visible)
        assertTrue(inWindow.id in visible)
        assertTrue(startedOnly.id in visible)
        assertTrue(endingOnly.id in visible)
        assertFalse(inactive.id in visible)
        assertFalse(future.id in visible)
        assertFalse(expired.id in visible)
        assertFalse(deleted.id in visible)

        // The banner payload carries the displayable fields.
        val item = client.get("/api/v1/alerts/visible").body<VisibleAlertList>()
            .items.single { it.id == inWindow.id }
        assertEquals("x", item.content)
    }

    @Test
    fun `visibility window bounds are inclusive`() {
        // Service-level with an injected `now` for exact boundary behavior the route (which
        // uses wall-clock time) cannot pin down.
        runBlocking {
            val now = 1_000_000L
            val service = TestServices.alerts

            val startsExactly = service.create(
                Alert(title = uniqueTitle("starts-now"), content = "x", startsAt = now),
            )
            val endsExactly = service.create(
                Alert(title = uniqueTitle("ends-now"), content = "x", endsAt = now),
            )
            val startsAfter = service.create(
                Alert(title = uniqueTitle("starts-later"), content = "x", startsAt = now + 1),
            )
            val endedBefore = service.create(
                Alert(title = uniqueTitle("ended-before"), content = "x", endsAt = now - 1),
            )

            val visible = service.visible(now = now).map { it.id }.toSet()
            assertTrue(startsExactly in visible)
            assertTrue(endsExactly in visible)
            assertFalse(startsAfter in visible)
            assertFalse(endedBefore in visible)

            // Clean up so these fixed-window rows never leak into route-level assertions.
            listOf(startsExactly, endsExactly, startsAfter, endedBefore).forEach { service.delete(it) }
        }
    }

    @Test
    fun `soft-deleted alert is invisible to read, update, delete and list`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val title = uniqueTitle("doomed")
        val created = client.createAlert(Alert(title = title, content = "body"))

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/alerts/${created.id}").status)

        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/alerts/${created.id}").status)
        val put = client.put("/api/v1/alerts/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(Alert(title = title, content = "edited"))
        }
        assertEquals(HttpStatusCode.NotFound, put.status)
        // Idempotent: a second delete finds no active row → 404.
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/alerts/${created.id}").status)
        val page = client.get("/api/v1/alerts?title=$title").body<AlertPageResponse>()
        assertEquals(0, page.total)
        assertTrue(page.items.isEmpty())
    }

    @Test
    fun `update and delete of a non-existent alert return 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val put = client.put("/api/v1/alerts/999999") {
            contentType(ContentType.Application.Json)
            setBody(Alert(title = "ghost", content = "x"))
        }
        assertEquals(HttpStatusCode.NotFound, put.status)
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/alerts/999999").status)
    }
}
