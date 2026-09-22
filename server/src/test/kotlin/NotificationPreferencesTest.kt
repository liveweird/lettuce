package ch.nokillswit

import ch.nokillswit.infra.mail.LogMailer
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.notifications.DisabledNotificationPreference
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationChannel
import ch.nokillswit.notifications.NotificationListFilter
import ch.nokillswit.notifications.NotificationPreferenceService
import ch.nokillswit.notifications.NotificationPreferencesResponse
import ch.nokillswit.notifications.NotificationPreferencesUpdateRequest
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.users.UserService
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.coroutineScope
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.deleteWhere
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `GET`/`PUT /api/v1/users/{id}/notification-preferences` (v4.0.0, V84) plus the mint-time
 * (`NotificationService.create`/`createAll`) and send-time (`NotificationEmailer.sendOne`)
 * suppression they drive. See "Preferences" in `.claude/docs/features/notifications.md`.
 */
class NotificationPreferencesTest {

    // Audit ids are logged as Longs; the shared hasKeyValue helper compares Strings only (the
    // IntegrationClientTest precedent).
    private fun ch.qos.logback.classic.spi.ILoggingEvent.hasLongValue(key: String, value: Long) =
        keyValuePairs?.any { it.key == key && it.value == value } == true

    private fun sentNote(recipientId: UInt) = Notification(
        recipientId = recipientId,
        type = NotificationType.FEEDBACK_SENT_TO_SUBJECT,
        params = mapOf("provider" to "Pat Provider", "subject" to "Sam Subject"),
        link = "/feedback/7/view",
    )

    @Test
    fun `GET default is every type on for both channels`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-default")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())

        val response = authedClient(email, "pw").get("/api/v1/users/$userId/notification-preferences")
        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.body<NotificationPreferencesResponse>()
        assertTrue(body.emailEnabled)
        assertEquals(NotificationType.entries.size, body.items.size)
        assertTrue(body.items.all { it.inApp && it.email })
        assertTrue(body.items.first { it.type == NotificationType.PASSWORD_CHANGED }.locked)
        assertTrue(body.items.none { it.type != NotificationType.PASSWORD_CHANGED && it.locked })
        assertTrue(body.items.any { it.feature == null }, "PASSWORD_CHANGED/CAREER_POSITION_STARTED_TO_USER are feature-neutral")
    }

    @Test
    fun `PUT round-trips and is idempotent`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-roundtrip")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        val client = authedClient(email, "pw")
        val disabled = listOf(
            DisabledNotificationPreference(NotificationType.PULSE_CYCLE_SCHEDULED, NotificationChannel.IN_APP),
            DisabledNotificationPreference(NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE, NotificationChannel.EMAIL),
        )
        suspend fun put() = client.put("/api/v1/users/$userId/notification-preferences") {
            contentType(ContentType.Application.Json)
            setBody(NotificationPreferencesUpdateRequest(disabled))
        }
        assertEquals(HttpStatusCode.NoContent, put().status)

        val fetched = client.get("/api/v1/users/$userId/notification-preferences").body<NotificationPreferencesResponse>()
        val scheduled = fetched.items.first { it.type == NotificationType.PULSE_CYCLE_SCHEDULED }
        assertFalse(scheduled.inApp)
        assertTrue(scheduled.email)
        val activated = fetched.items.first { it.type == NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE }
        assertTrue(activated.inApp)
        assertFalse(activated.email)

        // Idempotent: the same set again is 204 again, not a transition/error.
        assertEquals(HttpStatusCode.NoContent, put().status)
    }

    @Test
    fun `disabling a locked type is 400`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-locked")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        val response = authedClient(email, "pw").put("/api/v1/users/$userId/notification-preferences") {
            contentType(ContentType.Application.Json)
            setBody(
                NotificationPreferencesUpdateRequest(
                    listOf(DisabledNotificationPreference(NotificationType.PASSWORD_CHANGED, NotificationChannel.IN_APP)),
                ),
            )
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `an unknown type or channel name is 400`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-unknown")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        val client = authedClient(email, "pw")

        val badType = client.put("/api/v1/users/$userId/notification-preferences") {
            contentType(ContentType.Application.Json)
            setBody("""{"disabled":[{"type":"NOT_A_REAL_TYPE","channel":"IN_APP"}]}""")
        }
        assertEquals(HttpStatusCode.BadRequest, badType.status)

        val badChannel = client.put("/api/v1/users/$userId/notification-preferences") {
            contentType(ContentType.Application.Json)
            setBody("""{"disabled":[{"type":"PULSE_CYCLE_SCHEDULED","channel":"CARRIER_PIGEON"}]}""")
        }
        assertEquals(HttpStatusCode.BadRequest, badChannel.status)
    }

    @Test
    fun `self and admin may act, a stranger is 403, unknown or soft-deleted targets are 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("prefs-admin")
        val strangerEmail = uniqueEmail("prefs-stranger")
        val targetEmail = uniqueEmail("prefs-target")
        TestUsers.seed(email = adminEmail, password = "pw")
        TestUsers.seed(email = strangerEmail, password = "pw", roles = emptySet())
        val targetId = TestUsers.seed(email = targetEmail, password = "pw", roles = emptySet())
        val deletedId = TestUsers.seed(email = uniqueEmail("prefs-deleted"), password = "pw", roles = emptySet())
        assertEquals(1, TestServices.users.delete(deletedId))
        val body = NotificationPreferencesUpdateRequest(emptyList())

        assertEquals(
            HttpStatusCode.NoContent,
            authedClient(targetEmail, "pw").put("/api/v1/users/$targetId/notification-preferences") {
                contentType(ContentType.Application.Json)
                setBody(body)
            }.status,
            "self",
        )
        assertEquals(
            HttpStatusCode.OK,
            authedClient(targetEmail, "pw").get("/api/v1/users/$targetId/notification-preferences").status,
        )
        assertEquals(
            HttpStatusCode.NoContent,
            authedClient(adminEmail, "pw").put("/api/v1/users/$targetId/notification-preferences") {
                contentType(ContentType.Application.Json)
                setBody(body)
            }.status,
            "admin",
        )

        val strangerClient = authedClient(strangerEmail, "pw")
        assertEquals(HttpStatusCode.Forbidden, strangerClient.get("/api/v1/users/$targetId/notification-preferences").status)
        assertEquals(
            HttpStatusCode.Forbidden,
            strangerClient.put("/api/v1/users/$targetId/notification-preferences") {
                contentType(ContentType.Application.Json)
                setBody(body)
            }.status,
        )

        for (id in listOf(999999u, deletedId)) {
            assertEquals(
                HttpStatusCode.NotFound,
                authedClient(adminEmail, "pw").get("/api/v1/users/$id/notification-preferences").status,
                "GET for id $id",
            )
            assertEquals(
                HttpStatusCode.NotFound,
                authedClient(adminEmail, "pw").put("/api/v1/users/$id/notification-preferences") {
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }.status,
                "PUT for id $id",
            )
        }
    }

    @Test
    fun `audited only on an actual change`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-audit")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        val client = authedClient(email, "pw")
        val auditEvents = LogCapture("ch.nokillswit.audit")
        try {
            val disabled = listOf(
                DisabledNotificationPreference(NotificationType.PULSE_CYCLE_SCHEDULED, NotificationChannel.IN_APP),
            )
            suspend fun put() = client.put("/api/v1/users/$userId/notification-preferences") {
                contentType(ContentType.Application.Json)
                setBody(NotificationPreferencesUpdateRequest(disabled))
            }
            assertEquals(HttpStatusCode.NoContent, put().status)
            assertNotNull(
                auditEvents.events.firstOrNull { it.message == "user.notification_preferences_changed" },
                "the change must be audited",
            )

            assertEquals(HttpStatusCode.NoContent, put().status)
            assertEquals(
                1,
                auditEvents.events.count { it.message == "user.notification_preferences_changed" },
                "a same-set re-PUT must not audit again",
            )
        } finally {
            auditEvents.detach()
        }
    }

    @Test
    fun `an unknown stored type name is ignored by GET and does not block minting`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-orphan")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        // Bypasses the enum entirely — the only way to reproduce what an upgrade that renamed/
        // removed a type would leave behind (the NotificationService.knownType() precedent).
        suspendTransaction(TestServices.database) {
            NotificationPreferenceService.UserNotificationPreferences.insert {
                it[NotificationPreferenceService.UserNotificationPreferences.userId] = userId
                it[notificationType] = "DAYS_OFF_REQUESTED_TO_MANAGER"
                it[NotificationPreferenceService.UserNotificationPreferences.channel] = NotificationChannel.IN_APP.name
            }
        }
        val response = authedClient(email, "pw").get("/api/v1/users/$userId/notification-preferences")
        assertEquals(HttpStatusCode.OK, response.status)

        // A real, currently-enabled type must mint normally — the orphan row must not be read
        // as "everything is disabled" nor crash the disabled-set lookup.
        val id = TestNotifications.service.create(
            Notification(recipientId = userId, type = NotificationType.PULSE_CYCLE_SCHEDULED),
        )
        assertNotNull(id)
    }

    @Test
    fun `create suppresses the IN_APP row when disabled but still emails`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-inapp-off")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet(), name = "Ivy InApp")
        assertEquals(
            1,
            TestServices.notificationPreferences.replace(
                userId,
                setOf(NotificationType.FEEDBACK_SENT_TO_SUBJECT to NotificationChannel.IN_APP),
            ),
        )
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val id = coroutineScope {
                TestNotifications.withEmailer(this, LogMailer(), appUrl = null).create(sentNote(userId))
            }
            assertNull(id, "the insert must be suppressed")
            assertTrue(
                TestNotifications.service.list(userId, NotificationListFilter(), PageRequest(1, 20, emptyList())).items.isEmpty(),
            )
            assertNotNull(
                mail.events.firstOrNull { "To: $email" in it.formattedMessage },
                "the email mirror is unaffected by IN_APP suppression",
            )
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `create keeps the row but suppresses the email when the EMAIL channel is disabled`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-email-off")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        assertEquals(
            1,
            TestServices.notificationPreferences.replace(
                userId,
                setOf(NotificationType.FEEDBACK_SENT_TO_SUBJECT to NotificationChannel.EMAIL),
            ),
        )
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val id = coroutineScope {
                TestNotifications.withEmailer(this, LogMailer(), appUrl = null).create(sentNote(userId))
            }
            assertNotNull(id, "the in-app row must still be minted")
            assertNull(mail.events.firstOrNull { "To: $email" in it.formattedMessage }, "the email must be suppressed")
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `createAll suppresses IN_APP per-recipient while still emailing everyone`() = testApplication {
        usePostgresTestcontainer()
        val silencedEmail = uniqueEmail("prefs-createall-silenced")
        val normalEmail = uniqueEmail("prefs-createall-normal")
        val silencedId = TestUsers.seed(email = silencedEmail, password = "pw", roles = emptySet())
        val normalId = TestUsers.seed(email = normalEmail, password = "pw", roles = emptySet())
        assertEquals(
            1,
            TestServices.notificationPreferences.replace(
                silencedId,
                setOf(NotificationType.FEEDBACK_SENT_TO_SUBJECT to NotificationChannel.IN_APP),
            ),
        )
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            coroutineScope {
                TestNotifications.withEmailer(this, LogMailer(), appUrl = null)
                    .createAll(listOf(sentNote(silencedId), sentNote(normalId)))
            }
            assertTrue(
                TestNotifications.service.list(silencedId, NotificationListFilter(), PageRequest(1, 20, emptyList()))
                    .items.isEmpty(),
                "the silenced recipient gets no row",
            )
            assertTrue(
                TestNotifications.service.list(normalId, NotificationListFilter(), PageRequest(1, 20, emptyList()))
                    .items.isNotEmpty(),
                "the unaffected recipient still gets a row",
            )
            assertNotNull(
                mail.events.firstOrNull { "To: $silencedEmail" in it.formattedMessage },
                "the email mirror ignores IN_APP suppression",
            )
            assertNotNull(mail.events.firstOrNull { "To: $normalEmail" in it.formattedMessage })
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `PASSWORD_CHANGED cannot be silenced even via a raw preference row`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-locked-bypass")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        // A row like this can never be written through the PUT (replace() rejects locked types
        // with 400) — simulating it directly proves the lockedOn check ignores stored
        // preferences entirely, rather than merely refusing to persist new ones.
        suspendTransaction(TestServices.database) {
            listOf(NotificationChannel.IN_APP, NotificationChannel.EMAIL).forEach { channel ->
                NotificationPreferenceService.UserNotificationPreferences.insert {
                    it[NotificationPreferenceService.UserNotificationPreferences.userId] = userId
                    it[notificationType] = NotificationType.PASSWORD_CHANGED.name
                    it[NotificationPreferenceService.UserNotificationPreferences.channel] = channel.name
                }
            }
        }
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val id = coroutineScope {
                TestNotifications.withEmailer(this, LogMailer(), appUrl = null)
                    .create(Notification(recipientId = userId, type = NotificationType.PASSWORD_CHANGED))
            }
            assertNotNull(id, "PASSWORD_CHANGED must never be suppressed in-app")
            assertNotNull(
                mail.events.firstOrNull { "To: $email" in it.formattedMessage },
                "PASSWORD_CHANGED must never be suppressed by email",
            )
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `PASSWORD_CHANGED bypasses the V51 master opt-out too`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-locked-v51")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        assertEquals(1, TestServices.users.setEmailNotifications(userId, false))
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val id = coroutineScope {
                // The self-change path (no "self" param) — not the "reset" catalog-null wording.
                TestNotifications.withEmailer(this, LogMailer(), appUrl = null)
                    .create(Notification(recipientId = userId, type = NotificationType.PASSWORD_CHANGED))
            }
            assertNotNull(id, "PASSWORD_CHANGED must still mint in-app with the master opt-out on")
            val toUser = mail.events.filter { "To: $email" in it.formattedMessage }
            assertEquals(1, toUser.size, "the master opt-out must not suppress it")
            assertTrue("Your password was changed." in toUser.single().formattedMessage)
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `a deactivated target's GET and PUT still work`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("prefs-deact-admin")
        val targetEmail = uniqueEmail("prefs-deact-target")
        TestUsers.seed(email = adminEmail, password = "pw")
        val targetId = TestUsers.seed(email = targetEmail, password = "pw", roles = emptySet())
        assertEquals(1, TestServices.users.setDeactivated(targetId, true))
        val admin = authedClient(adminEmail, "pw")

        assertEquals(
            HttpStatusCode.OK,
            admin.get("/api/v1/users/$targetId/notification-preferences").status,
        )
        val response = admin.put("/api/v1/users/$targetId/notification-preferences") {
            contentType(ContentType.Application.Json)
            setBody(
                NotificationPreferencesUpdateRequest(
                    listOf(DisabledNotificationPreference(NotificationType.PULSE_CYCLE_SCHEDULED, NotificationChannel.IN_APP)),
                ),
            )
        }
        assertEquals(HttpStatusCode.NoContent, response.status, "a deactivated target is inert, not blocked")
        val fetched = admin.get("/api/v1/users/$targetId/notification-preferences")
        assertEquals(HttpStatusCode.OK, fetched.status)
        assertFalse(
            fetched.body<NotificationPreferencesResponse>()
                .items.first { it.type == NotificationType.PULSE_CYCLE_SCHEDULED }.inApp,
        )
    }

    @Test
    fun `the audit event carries targetUserId and the from-to preference deltas`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-audit-fields")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        val client = authedClient(email, "pw")
        val auditEvents = LogCapture("ch.nokillswit.audit")
        try {
            val response = client.put("/api/v1/users/$userId/notification-preferences") {
                contentType(ContentType.Application.Json)
                setBody(
                    NotificationPreferencesUpdateRequest(
                        listOf(DisabledNotificationPreference(NotificationType.PULSE_CYCLE_SCHEDULED, NotificationChannel.IN_APP)),
                    ),
                )
            }
            assertEquals(HttpStatusCode.NoContent, response.status)
            val event = auditEvents.events.first { it.message == "user.notification_preferences_changed" }
            assertTrue(event.hasLongValue("targetUserId", userId.toLong()))
            assertTrue(event.hasLongValue("byUserId", userId.toLong()))
            assertTrue(event.hasKeyValue("from", ""), "no preferences were disabled beforehand")
            assertTrue(event.hasKeyValue("to", "PULSE_CYCLE_SCHEDULED:IN_APP"))
        } finally {
            auditEvents.detach()
        }
    }

    @Test
    fun `a hard-deleted user cascades their preference rows`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("prefs-cascade")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        assertEquals(
            1,
            TestServices.notificationPreferences.replace(
                userId,
                setOf(NotificationType.PULSE_CYCLE_SCHEDULED to NotificationChannel.IN_APP),
            ),
        )
        // Users never hard-delete through the app (soft-delete only, see persistence.md) — this
        // exercises the FK's ON DELETE CASCADE directly, the schema-integrity half of "hard-
        // delete like user_disabled_features".
        suspendTransaction(TestServices.database) {
            UserService.Users.deleteWhere { UserService.Users.id eq userId }
        }
        val remaining = suspendTransaction(TestServices.database) {
            NotificationPreferenceService.UserNotificationPreferences.selectAll()
                .where { NotificationPreferenceService.UserNotificationPreferences.userId eq userId }
                .count()
        }
        assertEquals(0L, remaining)
    }
}
