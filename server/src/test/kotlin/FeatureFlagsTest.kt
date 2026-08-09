package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.auth.RefreshRequest
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.notifications.feature
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserFeaturesUpdateRequest
import ch.nokillswit.users.UserPageResponse
import ch.nokillswit.users.UserResponse
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Per-user feature flags (V46) end to end: the PUT /users/{id}/features matrix, the caller-only
 * 403 enforcement across every gated feature area (uniform — HR and ADMIN included), the
 * login/refresh claim roundtrip incl. the documented pre-refresh staleness window, the users-list
 * feature/featureEnabled filter pair, and the notifications list/total exclusion. The
 * `user.features_changed` audit event lives in AuditTest; the legacy-token (missing claim)
 * permissiveness in PrincipalAuthTest; the pure guard unit in GuardsTest.
 */
class FeatureFlagsTest {

    private suspend fun HttpClient.setFlags(userId: UInt, vararg features: Feature) =
        put("/api/v1/users/$userId/features") {
            contentType(ContentType.Application.Json)
            setBody(UserFeaturesUpdateRequest(features.toList()))
        }

    @Test
    fun `admin replaces, reads back, and clears a user's disabled set - idempotent wholesale PUT`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val targetId = TestUsers.seed(email = uniqueEmail("target"), password = "pw-123456789", roles = emptySet())

        assertEquals(HttpStatusCode.NoContent, admin.setFlags(targetId, Feature.GOALS, Feature.DAYS_OFF).status)
        // The response set is sorted by name.
        assertEquals(
            listOf(Feature.DAYS_OFF, Feature.GOALS),
            admin.get("/api/v1/users/$targetId").body<UserResponse>().disabledFeatures,
        )
        // Wholesale replace is idempotent — a same-set re-PUT is 204 again, not a 409 transition.
        assertEquals(HttpStatusCode.NoContent, admin.setFlags(targetId, Feature.DAYS_OFF, Feature.GOALS).status)
        // An empty array re-enables everything.
        assertEquals(HttpStatusCode.NoContent, admin.setFlags(targetId).status)
        assertEquals(emptyList(), admin.get("/api/v1/users/$targetId").body<UserResponse>().disabledFeatures)
    }

    @Test
    fun `changing flags is ADMIN-only, self-change allowed, unknown or soft-deleted target 404, junk feature 400`() =
        testApplication {
            usePostgresTestcontainer()
            val adminEmail = uniqueEmail("admin")
            val adminId = TestUsers.seed(email = adminEmail, password = "pw-123456789")
            val plainEmail = uniqueEmail("plain")
            val plainId = TestUsers.seed(email = plainEmail, password = "pw-123456789", roles = emptySet())

            val plain = authedClient(plainEmail, "pw-123456789")
            assertEquals(HttpStatusCode.Forbidden, plain.setFlags(plainId, Feature.GOALS).status)

            val admin = authedClient(adminEmail, "pw-123456789")
            // Self-change is deliberately allowed (unlike deactivation): the users routes are
            // never gated, so an admin can always adjust their own flags back.
            assertEquals(HttpStatusCode.NoContent, admin.setFlags(adminId, Feature.TEAM_KPIS).status)
            assertEquals(HttpStatusCode.NoContent, admin.setFlags(adminId).status)

            assertEquals(HttpStatusCode.NotFound, admin.setFlags(999_999_999u, Feature.GOALS).status)
            val goneId = TestUsers.seed(email = uniqueEmail("gone"), password = "pw-123456789", roles = emptySet())
            assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$goneId").status)
            assertEquals(HttpStatusCode.NotFound, admin.setFlags(goneId, Feature.GOALS).status)

            val junk = admin.put("/api/v1/users/$plainId/features") {
                contentType(ContentType.Application.Json)
                setBody("""{"disabledFeatures":["WIZARDRY"]}""")
            }
            assertEquals(HttpStatusCode.BadRequest, junk.status)
        }

    @Test
    fun `every gated area answers 403 for a fully disabled caller while the rest stays open`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val email = uniqueEmail("blocked")
        val userId = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())
        assertEquals(HttpStatusCode.NoContent, admin.setFlags(userId, *Feature.entries.toTypedArray()).status)

        // Logged in AFTER the change, so the token carries the full disabled set.
        val blocked = authedClient(email, "pw-123456789")
        val gated = listOf(
            "/api/v1/feedbacks",
            "/api/v1/feedbacks?view=kudos",
            "/api/v1/one-on-ones",
            "/api/v1/goals",
            "/api/v1/team-kpis",
            "/api/v1/performance-reviews",
            "/api/v1/review-periods",
            "/api/v1/days-off",
            "/api/v1/days-off/calendar",
            "/api/v1/public-holidays",
            "/api/v1/pulse-surveys/cycles",
            "/api/v1/pulse-surveys/visible-teams",
        )
        gated.forEach { path ->
            assertEquals(HttpStatusCode.Forbidden, blocked.get(path).status, "expected 403 for $path")
        }
        // A write is blocked before its body is even considered (403, not 400).
        val write = blocked.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = userId,
                    providerId = userId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = ch.nokillswit.feedbacks.FeedbackStatus.DRAFT,
                    content = "x",
                ),
            )
        }
        assertEquals(HttpStatusCode.Forbidden, write.status)
        // Ungated areas keep working: users, notifications, dashboard. (The users list is
        // scoped to the caller's own email — an unfiltered page would surface other tests'
        // seeded `@test` addresses, which the conformance validator's email format rejects.)
        assertEquals(HttpStatusCode.OK, blocked.get("/api/v1/users") { parameter("email", email) }.status)
        assertEquals(HttpStatusCode.OK, blocked.get("/api/v1/notifications").status)
        assertEquals(HttpStatusCode.OK, blocked.get("/api/v1/dashboard/summary").status)
    }

    @Test
    fun `a single disabled feature leaves the other five open`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val email = uniqueEmail("goalless")
        val userId = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())
        // MFA stays in the disabled set (its default) so the login below stays single-step.
        assertEquals(HttpStatusCode.NoContent, admin.setFlags(userId, Feature.GOALS, Feature.MFA).status)

        val client = authedClient(email, "pw-123456789")
        assertEquals(HttpStatusCode.Forbidden, client.get("/api/v1/goals").status)
        assertEquals(HttpStatusCode.OK, client.get("/api/v1/feedbacks").status)
        assertEquals(HttpStatusCode.OK, client.get("/api/v1/one-on-ones").status)
        assertEquals(
            HttpStatusCode.OK,
            client.get("/api/v1/days-off/calendar") { parameter("month", "2030-01") }.status,
        )
    }

    @Test
    fun `the gate is uniform - HR loses its audit read and ADMIN its registry management`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")

        val hrEmail = uniqueEmail("hr")
        val hrId = TestUsers.seed(email = hrEmail, password = "pw-123456789", roles = setOf(ch.nokillswit.users.UserRole.HR))
        assertEquals(HttpStatusCode.NoContent, admin.setFlags(hrId, Feature.FEEDBACKS, Feature.MFA).status)
        val hr = authedClient(hrEmail, "pw-123456789")
        val audit = hr.get("/api/v1/feedbacks") {
            parameter("view", "user")
            parameter("userId", adminId)
        }
        assertEquals(HttpStatusCode.Forbidden, audit.status)

        assertEquals(HttpStatusCode.NoContent, admin.setFlags(adminId, Feature.PERFORMANCE_REVIEWS, Feature.MFA).status)
        try {
            val gatedAdmin = authedClient(adminEmail, "pw-123456789")
            assertEquals(HttpStatusCode.Forbidden, gatedAdmin.get("/api/v1/review-periods").status)
            assertEquals(HttpStatusCode.Forbidden, gatedAdmin.post("/api/v1/review-periods").status)
        } finally {
            // The pre-change admin client still carries an ungated token — self-repair works.
            assertEquals(HttpStatusCode.NoContent, admin.setFlags(adminId, Feature.MFA).status)
        }
    }

    @Test
    fun `login and refresh carry the current set - a pre-change token keeps working until refresh`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val email = uniqueEmail("sliding")
        val userId = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())

        val json = jsonClient()
        val firstLogin = json.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "pw-123456789"))
        }.body<LoginResponse>()
        // A fresh user's only disabled flag is the inverted-default MFA (opt-in).
        assertEquals(listOf(Feature.MFA), firstLogin.disabledFeatures)

        val preChange = authedClient(email, "pw-123456789")
        assertEquals(HttpStatusCode.OK, preChange.get("/api/v1/goals").status)
        assertEquals(HttpStatusCode.NoContent, admin.setFlags(userId, Feature.GOALS, Feature.MFA).status)
        // The documented staleness window: the outstanding access token still passes until the
        // next refresh or login picks up the flag.
        assertEquals(HttpStatusCode.OK, preChange.get("/api/v1/goals").status)

        // A refresh with the PRE-change refresh token re-reads the user and carries the new set.
        val refreshed = json.post("/api/v1/refresh") {
            contentType(ContentType.Application.Json)
            setBody(RefreshRequest(firstLogin.refreshToken))
        }.body<LoginResponse>()
        assertEquals(listOf(Feature.GOALS, Feature.MFA), refreshed.disabledFeatures)

        val postChange = authedClient(email, "pw-123456789")
        assertEquals(HttpStatusCode.Forbidden, postChange.get("/api/v1/goals").status)
    }

    @Test
    fun `the users list filters by feature state and rejects a lone pair half`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val prefix = "FF-${java.util.UUID.randomUUID()}"
        val offId = TestUsers.seed(email = uniqueEmail("off"), password = "pw-123456789", name = "$prefix Off", roles = emptySet())
        val onId = TestUsers.seed(email = uniqueEmail("on"), password = "pw-123456789", name = "$prefix On", roles = emptySet())
        assertEquals(HttpStatusCode.NoContent, admin.setFlags(offId, Feature.GOALS).status)

        val disabled = admin.get("/api/v1/users") {
            parameter("name", prefix)
            parameter("feature", "GOALS")
            parameter("featureEnabled", "false")
        }.body<UserPageResponse>()
        assertEquals(listOf(offId), disabled.items.map { it.id })
        assertEquals(listOf(Feature.GOALS), disabled.items.single().disabledFeatures)

        val enabled = admin.get("/api/v1/users") {
            parameter("name", prefix)
            parameter("feature", "GOALS")
            parameter("featureEnabled", "true")
        }.body<UserPageResponse>()
        assertEquals(listOf(onId), enabled.items.map { it.id })

        // The pair rule: a lone half (either one) is 400, as is an unknown feature name.
        assertEquals(
            HttpStatusCode.BadRequest,
            admin.get("/api/v1/users") { parameter("feature", "GOALS") }.status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            admin.get("/api/v1/users") { parameter("featureEnabled", "true") }.status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            admin.get("/api/v1/users") {
                parameter("feature", "WIZARDRY")
                parameter("featureEnabled", "true")
            }.status,
        )
    }

    @Test
    fun `notifications of a disabled feature vanish from rows and total, and reappear on re-enable`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val email = uniqueEmail("muted")
        val userId = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())
        TestNotifications.seed(userId, label = "hidden-while-disabled")
        TestNotifications.service.create(Notification(recipientId = userId, type = NotificationType.PASSWORD_CHANGED))

        assertEquals(HttpStatusCode.NoContent, admin.setFlags(userId, Feature.FEEDBACKS, Feature.MFA).status)
        val muted = authedClient(email, "pw-123456789")
        val page = muted.get("/api/v1/notifications").body<NotificationPageResponse>()
        assertEquals(listOf(NotificationType.PASSWORD_CHANGED), page.items.map { it.type })
        assertEquals(1, page.total)
        // The SPA badge query: unseen-only, pageSize 1, total-only — must shrink the same way.
        val badge = muted.get("/api/v1/notifications") {
            parameter("wasSeen", "false")
            parameter("pageSize", "1")
        }.body<NotificationPageResponse>()
        assertEquals(1, badge.total)

        assertEquals(HttpStatusCode.NoContent, admin.setFlags(userId, Feature.MFA).status)
        val restored = authedClient(email, "pw-123456789")
        val after = restored.get("/api/v1/notifications").body<NotificationPageResponse>()
        assertEquals(2, after.total)
        // The hidden row comes back still unseen — nothing marked it in the meantime.
        assertTrue(after.items.first { it.type == NotificationType.FEEDBACK_SENT_TO_SUBJECT }.wasSeen.not())
    }

    @Test
    fun `every notification type except PASSWORD_CHANGED maps to its prefix feature`() {
        NotificationType.entries.forEach { type ->
            val expected = when {
                type == NotificationType.PASSWORD_CHANGED -> null
                type.name.startsWith("FEEDBACK_") -> Feature.FEEDBACKS
                type.name.startsWith("ONE_ON_ONE_") -> Feature.ONE_ON_ONES
                type.name.startsWith("GOAL_") -> Feature.GOALS
                type.name.startsWith("TEAM_KPI_") -> Feature.TEAM_KPIS
                type.name.startsWith("PERFORMANCE_REVIEW_") -> Feature.PERFORMANCE_REVIEWS
                type.name.startsWith("DAYS_OFF_") -> Feature.DAYS_OFF
                type.name.startsWith("PULSE_") -> Feature.PULSE_SURVEYS
                else -> error("Unclassified notification type $type — extend the mapping test")
            }
            assertEquals(expected, type.feature, "mapping for $type")
        }
    }
}
