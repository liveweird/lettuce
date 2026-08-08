package ch.nokillswit

import ch.nokillswit.pulse.PulseSettings
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * The pulse settings pair (the app's first runtime-editable configuration): ADMIN-only both
 * ways, validation bounds, the audit deltas, and the roundtrip. Values are GLOBAL shared
 * state in the shared container — every test restores the V47 defaults it may have changed.
 */
class PulseSettingsTest {

    private val url = "/api/v1/pulse-surveys/settings"

    private suspend fun HttpClient.save(cadenceWeeks: Int, openDays: Int) = put(url) {
        contentType(ContentType.Application.Json)
        setBody(PulseSettings(cadenceWeeks = cadenceWeeks, openDays = openDays))
    }

    @Test
    fun `roundtrip with audit deltas, then restore the defaults`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("pulse-set-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            assertEquals(HttpStatusCode.NoContent, admin.save(cadenceWeeks = 6, openDays = 10).status)
            val saved = admin.get(url).body<PulseSettings>()
            assertEquals(6, saved.cadenceWeeks)
            assertEquals(10, saved.openDays)
            assertNotNull(
                capture.awaitEvent {
                    it.message == "pulse_settings.updated" &&
                        it.keyValuePairs?.any { kv -> kv.key == "openDaysTo" && kv.value.toString() == "10" } == true
                },
            )
        } finally {
            capture.detach()
            assertEquals(HttpStatusCode.NoContent, admin.save(cadenceWeeks = 4, openDays = 7).status)
        }
    }

    @Test
    fun `validation bounds - 400 outside 1-52 and 1-90`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("pulse-set-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        assertEquals(HttpStatusCode.BadRequest, admin.save(cadenceWeeks = 0, openDays = 7).status)
        assertEquals(HttpStatusCode.BadRequest, admin.save(cadenceWeeks = 53, openDays = 7).status)
        assertEquals(HttpStatusCode.BadRequest, admin.save(cadenceWeeks = 4, openDays = 0).status)
        assertEquals(HttpStatusCode.BadRequest, admin.save(cadenceWeeks = 4, openDays = 91).status)
    }
}
