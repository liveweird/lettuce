package ch.nokillswit

import ch.nokillswit.daysoff.PublicHolidayItem
import ch.nokillswit.daysoff.PublicHolidayCreateRequest
import ch.nokillswit.daysoff.PublicHolidayList
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
 * The public-holiday registry: flat ADMIN-managed dates, hard-deleting, unique per date.
 * The registry is GLOBAL shared state in the shared container — tests use distinct far-off
 * (year, month) slots so their dates never collide with the days-off tests' cost windows.
 */
class PublicHolidayTest {

    @Test
    fun `the registry is readable by any authenticated user and ordered by date`() = testApplication {
        usePostgresTestcontainer()
        val first = TestDaysOff.holidays.create(PublicHolidayCreateRequest("2085-01-06", "Epiphany"))
        val second = TestDaysOff.holidays.create(PublicHolidayCreateRequest("2085-05-01", "Labour Day"))
        val plainEmail = uniqueEmail("holiday-reader")
        TestUsers.seed(plainEmail, "pw", roles = emptySet())

        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/public-holidays").status)
        val list = authedClient(plainEmail, "pw").get("/api/v1/public-holidays").body<PublicHolidayList>()
        val ours = list.items.filter { it.id == first || it.id == second }
        assertEquals(listOf("2085-01-06", "2085-05-01"), ours.map { it.date })
        assertEquals("Epiphany", ours.first().name)
        // Ordered by date over the whole registry (dates are unique).
        assertEquals(list.items.sortedBy { it.date }, list.items)
    }

    @Test
    fun `mutations are ADMIN-only`() = testApplication {
        usePostgresTestcontainer()
        val plainEmail = uniqueEmail("holiday-plain")
        TestUsers.seed(plainEmail, "pw", roles = emptySet())
        val plain = authedClient(plainEmail, "pw")
        val existing = TestDaysOff.holidays.create(PublicHolidayCreateRequest("2085-06-16", "Some Day"))

        assertEquals(
            HttpStatusCode.Forbidden,
            plain.post("/api/v1/public-holidays") {
                contentType(ContentType.Application.Json)
                setBody(PublicHolidayCreateRequest("2085-06-17", "Blocked"))
            }.status,
        )
        assertEquals(HttpStatusCode.Forbidden, plain.delete("/api/v1/public-holidays/$existing").status)
    }

    @Test
    fun `create validates the shape and rejects a duplicate date with 409`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("holiday-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")

        suspend fun tryCreate(date: String, name: String) = admin.post("/api/v1/public-holidays") {
            contentType(ContentType.Application.Json)
            setBody(PublicHolidayCreateRequest(date, name))
        }

        assertEquals(HttpStatusCode.BadRequest, tryCreate("2086-1-06", "Sloppy").status)
        assertEquals(HttpStatusCode.BadRequest, tryCreate("garbage", "Nope").status)
        assertEquals(HttpStatusCode.BadRequest, tryCreate("2086-02-30", "Nope").status)
        assertEquals(HttpStatusCode.BadRequest, tryCreate("2086-01-06", "  ").status)
        assertEquals(HttpStatusCode.BadRequest, tryCreate("2086-01-06", "x".repeat(101)).status)

        val response = tryCreate("2086-01-06", "Epiphany")
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<PublicHolidayItem>()
        assertEquals("/api/v1/public-holidays/${created.id}", response.headers["Location"])
        assertEquals("2086-01-06", created.date)
        // One holiday per date.
        assertEquals(HttpStatusCode.Conflict, tryCreate("2086-01-06", "Duplicate").status)
    }

    @Test
    fun `delete is a hard delete and 404s on a missing id`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("holiday-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val id = TestDaysOff.holidays.create(PublicHolidayCreateRequest("2087-03-03", "Disposable"))

        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/public-holidays/$id").status)
        assertEquals(HttpStatusCode.NotFound, admin.delete("/api/v1/public-holidays/$id").status)
        val list = admin.get("/api/v1/public-holidays").body<PublicHolidayList>()
        assertTrue(list.items.none { it.id == id })
        // The date is reusable — hard delete, no soft-delete ghost.
        assertNotNull(TestDaysOff.holidays.create(PublicHolidayCreateRequest("2087-03-03", "Again")))
    }

    @Test
    fun `the V41 seed provides the Polish statutory holidays for 2026 and 2027`() = testApplication {
        usePostgresTestcontainer()
        val plainEmail = uniqueEmail("holiday-seed-reader")
        TestUsers.seed(plainEmail, "pw", roles = emptySet())
        val list = authedClient(plainEmail, "pw").get("/api/v1/public-holidays").body<PublicHolidayList>()
        val byDate = list.items.associate { it.date to it.name }

        // Spot checks across fixed and movable feasts (Easter derivatives differ per year).
        assertEquals("Boże Ciało", byDate["2026-06-04"])
        assertEquals("Poniedziałek Wielkanocny", byDate["2027-03-29"])
        assertEquals("Wigilia Bożego Narodzenia", byDate["2026-12-24"])
        assertEquals("Święto Pracy", byDate["2027-05-01"])
        // 14 statutory days per year (>= tolerates test-added rows in those years).
        assertTrue(list.items.count { it.date.startsWith("2026-") } >= 14)
        assertTrue(list.items.count { it.date.startsWith("2027-") } >= 14)
    }

    @Test
    fun `holiday mutations land in the security audit trail`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("holiday-audit-admin")
        val adminId = TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            val created = admin.post("/api/v1/public-holidays") {
                contentType(ContentType.Application.Json)
                setBody(PublicHolidayCreateRequest("2088-11-11", "Independence Day"))
            }.body<PublicHolidayItem>()
            admin.delete("/api/v1/public-holidays/${created.id}")

            val createdEvent = capture.awaitEvent {
                it.message == "public_holiday.created" &&
                    it.keyValuePairs?.any { kv -> kv.key == "holidayId" && kv.value == created.id.toLong() } == true
            }
            assertNotNull(createdEvent)
            assertEquals(adminId.toLong(), createdEvent.keyValuePairs.first { it.key == "byUserId" }.value)
            assertTrue(createdEvent.hasKeyValue("date", "2088-11-11"))
            assertNotNull(
                capture.awaitEvent {
                    it.message == "public_holiday.deleted" &&
                        it.keyValuePairs?.any { kv -> kv.key == "holidayId" && kv.value == created.id.toLong() } == true
                },
            )
        } finally {
            capture.detach()
        }
    }
}
