package ch.nokillswit

import ch.nokillswit.alerts.Alert
import ch.nokillswit.alerts.AlertResponse
import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.dictionaries.DictionaryEntryInput
import ch.nokillswit.dictionaries.DictionaryEntryList
import ch.nokillswit.dictionaries.DictionaryUpdateRequest
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamResponse
import ch.nokillswit.templates.Template
import ch.nokillswit.templates.TemplateResponse
import ch.nokillswit.users.UserRole
import ch.nokillswit.users.UserUpdateRequest
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import java.util.UUID
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The audit trail (audit/Audit.kt) is structured SLF4J logging on the dedicated
 * `ch.nokillswit.audit` logger with the AUDIT marker — captured here with a Logback
 * ListAppender. The events themselves are emitted from the auth/user routes.
 */
class AuditTest {



    @Test
    fun `login failure and success emit AUDIT-marked events with fields`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("audit")
        val userId = TestUsers.seed(email = email, password = "pw-123456789")
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val client = jsonClient()
            client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, "wrong-password"))
            }
            client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, "pw-123456789"))
            }

            val failure = appender.events.find {
                it.message == "login.failure" && it.keyValuePairs.any { kv -> kv.key == "email" && kv.value == email }
            }
            assertNotNull(failure, "expected a login.failure audit event")
            assertTrue(failure.markerList.any { it.name == "AUDIT" })
            assertEquals("wrong_password", failure.keyValuePairs.first { it.key == "reason" }.value)

            val success = appender.events.find {
                it.message == "login.success" && it.keyValuePairs.any { kv -> kv.key == "email" && kv.value == email }
            }
            assertNotNull(success, "expected a login.success audit event")
            assertEquals(userId.toLong(), success.keyValuePairs.first { it.key == "userId" }.value)
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `deactivation transitions emit user deactivated and reactivated events`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("audit-deact-admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val targetId = TestUsers.seed(email = uniqueEmail("audit-deact-target"), password = "pw", roles = emptySet())
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val client = authedClient(adminEmail, "pw-123456789")
            client.post("/api/v1/users/$targetId/deactivate")
            client.post("/api/v1/users/$targetId/activate")

            listOf("user.deactivated", "user.reactivated").forEach { eventName ->
                val event = appender.events.find { it.message == eventName }
                assertNotNull(event, "expected a $eventName audit event")
                assertTrue(event.markerList.any { it.name == "AUDIT" })
                assertEquals(adminId.toLong(), event.keyValuePairs.first { it.key == "byUserId" }.value)
                assertEquals(targetId.toLong(), event.keyValuePairs.first { it.key == "targetUserId" }.value)
                // No career positions → the v2.17.0 stamp fields are OMITTED, not null.
                assertTrue(event.keyValuePairs.none { it.key == "careerPositionId" })
            }
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `deactivation with a career position carries the closed position in the audit event`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("audit-cpos-admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val mgrId = TestUsers.seed(email = uniqueEmail("audit-cpos-mgr"), password = "pw", roles = emptySet())
        val targetId = TestUsers.seed(email = uniqueEmail("audit-cpos-target"), password = "pw", roles = emptySet())
        val teamId = TestServices.teams.create(
            ch.nokillswit.teams.Team(name = "audit-cpos-${java.util.UUID.randomUUID()}", managerId = mgrId),
        )
        TestServices.teams.addMember(teamId, targetId)
        val marker = java.util.UUID.randomUUID().toString().take(8)
        val (pathId) = TestDictionaries.append(ch.nokillswit.dictionaries.Dictionary.CAREER_PATH, "AuC $marker")
        val (specId) = TestDictionaries.append(ch.nokillswit.dictionaries.Dictionary.CAREER_SPECIALIZATION, "AuS $marker")
        val (levelId) = TestDictionaries.append(ch.nokillswit.dictionaries.Dictionary.SENIORITY_LEVEL, "AuL $marker")
        val (positionId, _) = TestServices.careerPositions.create(
            mgrId, targetId, ch.nokillswit.users.CareerPositionWrite("2022-02-02", pathId, specId, levelId),
        )
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val client = authedClient(adminEmail, "pw-123456789")
            client.post("/api/v1/users/$targetId/deactivate")
            client.post("/api/v1/users/$targetId/activate")

            val deactivated = appender.events.find { it.message == "user.deactivated" }
            assertNotNull(deactivated)
            assertEquals(positionId.toLong(), deactivated.keyValuePairs.first { it.key == "careerPositionId" }.value)
            assertEquals(
                java.time.LocalDate.now().toString(),
                deactivated.keyValuePairs.first { it.key == "careerPositionEndDate" }.value,
            )
            val reactivated = appender.events.find { it.message == "user.reactivated" }
            assertNotNull(reactivated)
            assertEquals(positionId.toLong(), reactivated.keyValuePairs.first { it.key == "careerPositionId" }.value)
            assertTrue(reactivated.keyValuePairs.none { it.key == "careerPositionEndDate" })
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `a forbidden request emits an authz denied event with the caller id`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("authz")
        val callerId = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())
        val otherId = TestUsers.seed(email = uniqueEmail("other"), password = "pw-123456789")
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val client = jsonClient()
            val token = client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, "pw-123456789"))
            }.body<LoginResponse>().token

            // A USER reading someone else's profile is a 403 → audited.
            client.get("/api/v1/users/$otherId") {
                header(HttpHeaders.Authorization, "Bearer $token")
            }

            val denied = appender.events.find { it.message == "authz.denied" }
            assertNotNull(denied, "expected an authz.denied audit event")
            assertEquals(callerId.toLong(), denied.keyValuePairs.first { it.key == "userId" }.value)
            assertEquals("GET", denied.keyValuePairs.first { it.key == "method" }.value)
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `team mutations emit audit events`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw")
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", roles = emptySet())
        val newManagerId = TestUsers.seed(email = uniqueEmail("mgr2"), password = "pw", roles = emptySet())
        val memberId = TestUsers.seed(email = uniqueEmail("member"), password = "pw", roles = emptySet())
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val client = authedClient(adminEmail, "pw")
            val teamId = client.post("/api/v1/teams") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "Audited", managerId = managerId, memberIds = emptyList()))
            }.body<TeamResponse>().id

            client.put("/api/v1/teams/$teamId") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "Audited", managerId = newManagerId, memberIds = listOf(memberId)))
            }
            client.put("/api/v1/teams/$teamId/members/$managerId")
            client.delete("/api/v1/teams/$teamId/members/$managerId")
            client.delete("/api/v1/teams/$teamId")

            val created = appender.events.find { it.message == "team.created" }
            assertNotNull(created, "expected a team.created audit event")
            assertEquals(adminId.toLong(), created.keyValuePairs.first { it.key == "byUserId" }.value)
            assertEquals(managerId.toLong(), created.keyValuePairs.first { it.key == "managerId" }.value)

            val updated = appender.events.find { it.message == "team.updated" }
            assertNotNull(updated, "expected a team.updated audit event")
            assertEquals(managerId.toLong(), updated.keyValuePairs.first { it.key == "managerFrom" }.value)
            assertEquals(newManagerId.toLong(), updated.keyValuePairs.first { it.key == "managerTo" }.value)
            assertEquals(memberId.toString(), updated.keyValuePairs.first { it.key == "membersAdded" }.value)

            val memberAdded = appender.events.find { it.message == "team.member_added" }
            assertNotNull(memberAdded, "expected a team.member_added audit event")
            assertEquals(managerId.toLong(), memberAdded.keyValuePairs.first { it.key == "memberUserId" }.value)

            assertNotNull(appender.events.find { it.message == "team.member_removed" })
            val deleted = appender.events.find { it.message == "team.deleted" }
            assertNotNull(deleted, "expected a team.deleted audit event")
            assertEquals(teamId.toLong(), deleted.keyValuePairs.first { it.key == "teamId" }.value)
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `alert and template mutations emit audit events`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw")
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val client = authedClient(adminEmail, "pw")

            val alertId = client.post("/api/v1/alerts") {
                contentType(ContentType.Application.Json)
                setBody(Alert(title = "audit-${UUID.randomUUID()}", content = "trail"))
            }.body<AlertResponse>().id
            client.delete("/api/v1/alerts/$alertId")

            val templateName = "audit-${UUID.randomUUID()}"
            val templateId = client.post("/api/v1/templates") {
                contentType(ContentType.Application.Json)
                setBody(Template(name = templateName, content = "c"))
            }.body<TemplateResponse>().id
            client.put("/api/v1/templates/$templateId") {
                contentType(ContentType.Application.Json)
                setBody(Template(name = templateName, content = "c2"))
            }
            client.delete("/api/v1/templates/$templateId")

            for (event in listOf("alert.created", "alert.deleted", "template.created", "template.updated", "template.deleted")) {
                val hit = appender.events.find { it.message == event }
                assertNotNull(hit, "expected a $event audit event")
                assertEquals(adminId.toLong(), hit.keyValuePairs.first { it.key == "byUserId" }.value)
            }
            assertEquals(
                alertId.toLong(),
                appender.events.first { it.message == "alert.created" }.keyValuePairs.first { it.key == "alertId" }.value,
            )
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `dictionary updates emit audit events with change counts only on success`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw")
        val userEmail = uniqueEmail("user")
        TestUsers.seed(email = userEmail, password = "pw", roles = emptySet())
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val adminClient = authedClient(adminEmail, "pw")
            val userClient = authedClient(userEmail, "pw")

            // Baseline document, then one save doing an add + a rename + a removal at once.
            val (a, b) = "audit-a-${UUID.randomUUID()}" to "audit-b-${UUID.randomUUID()}"
            adminClient.put("/api/v1/dictionaries/career-paths") {
                contentType(ContentType.Application.Json)
                setBody(
                    DictionaryUpdateRequest(
                        items = listOf(
                            DictionaryEntryInput(values = mapOf("en" to a)),
                            DictionaryEntryInput(values = mapOf("en" to b)),
                        ),
                    ),
                )
            }
            val entries = adminClient.get("/api/v1/dictionaries/career-paths").body<DictionaryEntryList>().items
            val aId = entries.first { it.values.getValue("en") == a }.id
            adminClient.put("/api/v1/dictionaries/career-paths") {
                contentType(ContentType.Application.Json)
                setBody(
                    DictionaryUpdateRequest(
                        items = listOf(
                            // Translation-only change: adding a Polish value counts as a rename.
                            DictionaryEntryInput(id = aId, values = mapOf("en" to a, "pl" to "$a-pl")),
                            DictionaryEntryInput(values = mapOf("en" to "audit-c-${UUID.randomUUID()}")),
                        ),
                    ),
                )
            }

            val hit = appender.events.last { it.message == "dictionary.updated" }
            assertEquals(adminId.toLong(), hit.keyValuePairs.first { it.key == "byUserId" }.value)
            assertEquals("CAREER_PATH", hit.keyValuePairs.first { it.key == "dictionary" }.value)
            assertEquals(1, hit.keyValuePairs.first { it.key == "added" }.value)
            assertEquals(1, hit.keyValuePairs.first { it.key == "renamed" }.value)
            assertEquals(1, hit.keyValuePairs.first { it.key == "removed" }.value)
            val successCount = appender.events.count { it.message == "dictionary.updated" }

            // A rejected save (403 non-admin, 400 blank value) mints no phantom event.
            userClient.put("/api/v1/dictionaries/career-paths") {
                contentType(ContentType.Application.Json)
                setBody(DictionaryUpdateRequest(items = listOf(DictionaryEntryInput(values = mapOf("en" to "x")))))
            }
            adminClient.put("/api/v1/dictionaries/career-paths") {
                contentType(ContentType.Application.Json)
                setBody(DictionaryUpdateRequest(items = listOf(DictionaryEntryInput(values = mapOf("en" to "   ")))))
            }
            assertEquals(successCount, appender.events.count { it.message == "dictionary.updated" })
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `feature flag changes emit user features_changed with from-to sets, no-op re-PUTs stay silent`() =
        testApplication {
            usePostgresTestcontainer()
            val adminEmail = uniqueEmail("admin")
            val adminId = TestUsers.seed(email = adminEmail, password = "pw")
            val targetId = TestUsers.seed(email = uniqueEmail("flag-target"), password = "pw", roles = emptySet())
            val appender = LogCapture("ch.nokillswit.audit")
            try {
                val client = authedClient(adminEmail, "pw")
                client.put("/api/v1/users/$targetId/features") {
                    contentType(ContentType.Application.Json)
                    setBody(
                        ch.nokillswit.users.UserFeaturesUpdateRequest(
                            listOf(ch.nokillswit.users.Feature.GOALS, ch.nokillswit.users.Feature.DAYS_OFF),
                        ),
                    )
                }
                val change = appender.events.find { it.message == "user.features_changed" }
                assertNotNull(change, "expected a user.features_changed audit event")
                assertEquals(adminId.toLong(), change.keyValuePairs.first { it.key == "byUserId" }.value)
                assertEquals(targetId.toLong(), change.keyValuePairs.first { it.key == "targetUserId" }.value)
                // A fresh user's from-set is the inverted-default MFA row, not empty.
                assertEquals("MFA", change.keyValuePairs.first { it.key == "from" }.value)
                assertEquals("DAYS_OFF,GOALS", change.keyValuePairs.first { it.key == "to" }.value)

                // A same-set re-PUT is a no-op replace — no second event.
                client.put("/api/v1/users/$targetId/features") {
                    contentType(ContentType.Application.Json)
                    setBody(
                        ch.nokillswit.users.UserFeaturesUpdateRequest(
                            listOf(ch.nokillswit.users.Feature.DAYS_OFF, ch.nokillswit.users.Feature.GOALS),
                        ),
                    )
                }
                assertEquals(1, appender.events.count { it.message == "user.features_changed" })
            } finally {
                appender.detach()
            }
        }

    @Test
    fun `user updates emit user updated with deltas only for changed fields`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw")
        val targetEmail = uniqueEmail("target")
        val targetId = TestUsers.seed(email = targetEmail, password = "pw", roles = emptySet())
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val client = authedClient(adminEmail, "pw")

            // Name-only change → user.updated with name deltas, no email deltas.
            client.put("/api/v1/users/$targetId") {
                contentType(ContentType.Application.Json)
                setBody(UserUpdateRequest(name = "Renamed", email = targetEmail, roles = emptyList()))
            }
            val nameChange = appender.events.find { it.message == "user.updated" }
            assertNotNull(nameChange, "expected a user.updated audit event")
            assertEquals(adminId.toLong(), nameChange.keyValuePairs.first { it.key == "byUserId" }.value)
            assertEquals(targetId.toLong(), nameChange.keyValuePairs.first { it.key == "targetUserId" }.value)
            assertEquals("Renamed", nameChange.keyValuePairs.first { it.key == "nameTo" }.value)
            assertTrue(nameChange.keyValuePairs.none { it.key == "emailFrom" })

            // Email change → email deltas present.
            val newEmail = uniqueEmail("target-moved")
            client.put("/api/v1/users/$targetId") {
                contentType(ContentType.Application.Json)
                setBody(UserUpdateRequest(name = "Renamed", email = newEmail, roles = emptyList()))
            }
            val emailChange = appender.events.last { it.message == "user.updated" }
            assertEquals(targetEmail, emailChange.keyValuePairs.first { it.key == "emailFrom" }.value)
            assertEquals(newEmail, emailChange.keyValuePairs.first { it.key == "emailTo" }.value)
            assertTrue(emailChange.keyValuePairs.none { it.key == "nameFrom" })

            // Roles-only change → user.roles_changed but NO further user.updated.
            client.put("/api/v1/users/$targetId") {
                contentType(ContentType.Application.Json)
                setBody(UserUpdateRequest(name = "Renamed", email = newEmail, roles = listOf(UserRole.ADMIN)))
            }
            val rolesChange = appender.events.find { it.message == "user.roles_changed" }
            assertNotNull(rolesChange, "expected a user.roles_changed audit event")
            assertEquals("", rolesChange.keyValuePairs.first { it.key == "from" }.value)
            assertEquals("ADMIN", rolesChange.keyValuePairs.first { it.key == "to" }.value)
            assertEquals(2, appender.events.count { it.message == "user.updated" })

            // No-change PUT → nothing new at all.
            client.put("/api/v1/users/$targetId") {
                contentType(ContentType.Application.Json)
                setBody(UserUpdateRequest(name = "Renamed", email = newEmail, roles = listOf(UserRole.ADMIN)))
            }
            assertEquals(2, appender.events.count { it.message == "user.updated" })
            assertEquals(1, appender.events.count { it.message == "user.roles_changed" })
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `career position mutations emit their own audit events with deltas`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("cpa-m")
        val subEmail = uniqueEmail("cpa-s")
        val mgrId = TestUsers.seed(email = mgrEmail, password = "pw", roles = emptySet())
        val subId = TestUsers.seed(email = subEmail, password = "pw", roles = emptySet())
        val teamId = TestServices.teams.create(
            ch.nokillswit.teams.Team(name = "cpa-${java.util.UUID.randomUUID()}", managerId = mgrId),
        )
        TestServices.teams.addMember(teamId, subId)
        val marker = java.util.UUID.randomUUID().toString().take(8)
        val ids = TestDictionaries.append(
            ch.nokillswit.dictionaries.Dictionary.CAREER_PATH,
            "CpAudit A $marker",
            "CpAudit B $marker",
        )
        val (specId) = TestDictionaries.append(
            ch.nokillswit.dictionaries.Dictionary.CAREER_SPECIALIZATION, "CpAudit S $marker",
        )
        val (levelId) = TestDictionaries.append(
            ch.nokillswit.dictionaries.Dictionary.SENIORITY_LEVEL, "CpAudit L $marker",
        )
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val client = authedClient(mgrEmail, "pw")

            // Create → career_position.created with the start date and the set ref ids only.
            val created = client.post("/api/v1/users/$subId/career-positions") {
                contentType(ContentType.Application.Json)
                setBody(ch.nokillswit.users.CareerPositionWrite("2020-02-02", ids[0], specId, levelId))
            }.body<ch.nokillswit.users.CareerPositionResponse>()
            val createdEvent = appender.events.find { it.message == "career_position.created" }
            assertNotNull(createdEvent, "expected a career_position.created audit event")
            assertEquals(mgrId.toLong(), createdEvent.keyValuePairs.first { it.key == "byUserId" }.value)
            assertEquals(subId.toLong(), createdEvent.keyValuePairs.first { it.key == "targetUserId" }.value)
            assertEquals("2020-02-02", createdEvent.keyValuePairs.first { it.key == "startDate" }.value)
            assertEquals(ids[0].toLong(), createdEvent.keyValuePairs.first { it.key == "careerPathId" }.value)
            // The full triple is required since v2.15.1 — all three ids ride the event.
            assertEquals(levelId.toLong(), createdEvent.keyValuePairs.first { it.key == "seniorityLevelId" }.value)

            // Correction → career_position.updated with From/To deltas for what changed.
            client.put("/api/v1/users/$subId/career-positions/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(ch.nokillswit.users.CareerPositionWrite("2020-03-03", ids[1], specId, levelId))
            }
            val updated = appender.events.find { it.message == "career_position.updated" }
            assertNotNull(updated, "expected a career_position.updated audit event")
            assertEquals("2020-02-02", updated.keyValuePairs.first { it.key == "startDateFrom" }.value)
            assertEquals("2020-03-03", updated.keyValuePairs.first { it.key == "startDateTo" }.value)
            assertEquals(ids[0].toLong(), updated.keyValuePairs.first { it.key == "careerPathFrom" }.value)
            assertEquals(ids[1].toLong(), updated.keyValuePairs.first { it.key == "careerPathTo" }.value)

            // Delete → career_position.deleted with the (final) start date.
            client.delete("/api/v1/users/$subId/career-positions/${created.id}")
            val deleted = appender.events.find { it.message == "career_position.deleted" }
            assertNotNull(deleted, "expected a career_position.deleted audit event")
            assertEquals("2020-03-03", deleted.keyValuePairs.first { it.key == "startDate" }.value)
        } finally {
            appender.detach()
        }
    }

    // (The allowance deltas left user.updated/user.created in v2.32.0 — the new
    // days_off.allowance_changed event is pinned in DaysOffAllowanceTest.)

    @Test
    fun `unique id changes carry deltas in user updated and user created`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val targetEmail = uniqueEmail("uid-target")
        val targetId = TestUsers.seed(email = targetEmail, password = "pw", roles = emptySet())
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val client = authedClient(adminEmail, "pw")
            val tag = uniqueEmail("uid").substringBefore("@")

            suspend fun putUniqueId(value: String?) = client.put("/api/v1/users/$targetId") {
                contentType(ContentType.Application.Json)
                setBody(UserUpdateRequest(name = "Test", email = targetEmail, roles = emptyList(), uniqueId = value))
            }

            // First assignment: To present, From absent (previously unset).
            putUniqueId("A-$tag")
            val assigned = appender.events.find { it.message == "user.updated" }
            assertNotNull(assigned, "expected a user.updated audit event")
            assertEquals("A-$tag", assigned.keyValuePairs.first { it.key == "uniqueIdTo" }.value)
            assertTrue(assigned.keyValuePairs.none { it.key == "uniqueIdFrom" })

            // Resubmitting the same value (or null) is not a change → nothing new.
            putUniqueId("A-$tag")
            putUniqueId(null)
            assertEquals(1, appender.events.count { it.message == "user.updated" })

            // Changing it → From and To both present.
            putUniqueId("B-$tag")
            val changed = appender.events.last { it.message == "user.updated" }
            assertEquals("A-$tag", changed.keyValuePairs.first { it.key == "uniqueIdFrom" }.value)
            assertEquals("B-$tag", changed.keyValuePairs.first { it.key == "uniqueIdTo" }.value)

            // Create with a unique id → user.created carries it.
            client.post("/api/v1/users") {
                contentType(ContentType.Application.Json)
                setBody(
                    ch.nokillswit.users.UserRequest(
                        name = "Uid Created", email = uniqueEmail("uid-created"),
                        password = "pw-123456789", uniqueId = "C-$tag",
                    ),
                )
            }
            val created = appender.events.find { it.message == "user.created" }
            assertNotNull(created, "expected a user.created audit event")
            assertEquals("C-$tag", created.keyValuePairs.first { it.key == "uniqueId" }.value)
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `no-op member mutations and phantom template updates emit no audit events`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", roles = emptySet())
        val memberId = TestUsers.seed(email = uniqueEmail("member"), password = "pw", roles = emptySet())
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val client = authedClient(adminEmail, "pw")
            val teamId = client.post("/api/v1/teams") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "NoOps", managerId = managerId, memberIds = emptyList()))
            }.body<TeamResponse>().id

            // Re-adding an existing member is a 204 no-op — audited exactly once.
            assertEquals(HttpStatusCode.NoContent, client.put("/api/v1/teams/$teamId/members/$memberId").status)
            assertEquals(HttpStatusCode.NoContent, client.put("/api/v1/teams/$teamId/members/$memberId").status)
            assertEquals(1, appender.events.count { it.message == "team.member_added" })

            // Removing once is audited; removing a non-member again is a silent 204.
            assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/teams/$teamId/members/$memberId").status)
            assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/teams/$teamId/members/$memberId").status)
            assertEquals(1, appender.events.count { it.message == "team.member_removed" })

            // A PUT to a nonexistent template is 404 and must not mint a phantom template.updated.
            val response = client.put("/api/v1/templates/999999999") {
                contentType(ContentType.Application.Json)
                setBody(Template(name = "ghost-${UUID.randomUUID()}", content = "c"))
            }
            assertEquals(HttpStatusCode.NotFound, response.status)
            assertEquals(0, appender.events.count { it.message == "template.updated" })
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `days-off correction create, update, and delete are audited (never the comment)`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("corraudit-m")
        val mgrId = TestUsers.seed(mgrEmail, "pw", roles = emptySet())
        val subId = TestUsers.seed(uniqueEmail("corraudit-s"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "corraudit-${UUID.randomUUID()}", managerId = mgrId))
        TestServices.teams.addMember(teamId, subId)
        val manager = authedClient(mgrEmail, "pw")
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val created = manager.post("/api/v1/days-off/corrections") {
                contentType(ContentType.Application.Json)
                setBody(
                    ch.nokillswit.daysoff.DaysOffCorrectionWrite(
                        userId = subId,
                        year = 2030,
                        operation = ch.nokillswit.daysoff.DaysOffCorrectionOperation.ADD,
                        days = 2.0,
                        comment = "secret-audit-comment",
                    ),
                )
            }.body<ch.nokillswit.daysoff.DaysOffCorrectionResponse>()
            val createdEvent = appender.events.find { it.message == "days_off_correction.created" }
            assertNotNull(createdEvent, "correction create should be audited")
            assertEquals(mgrId.toLong(), createdEvent.keyValuePairs.first { it.key == "byUserId" }.value)
            assertEquals(subId.toLong(), createdEvent.keyValuePairs.first { it.key == "targetUserId" }.value)
            assertEquals(2.0, createdEvent.keyValuePairs.first { it.key == "days" }.value)
            // The encrypted comment must never reach the audit log.
            assertTrue(createdEvent.keyValuePairs.none { "secret" in it.value.toString() })

            val updated = manager.put("/api/v1/days-off/corrections/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    ch.nokillswit.daysoff.DaysOffCorrectionWrite(
                        userId = subId,
                        year = 2030,
                        operation = ch.nokillswit.daysoff.DaysOffCorrectionOperation.SUBTRACT,
                        days = 1.5,
                        comment = "secret-audit-comment-2",
                    ),
                )
            }
            assertEquals(HttpStatusCode.NoContent, updated.status)
            val updatedEvent = appender.events.find { it.message == "days_off_correction.updated" }
            assertNotNull(updatedEvent, "correction update should be audited")
            assertEquals("SUBTRACT", updatedEvent.keyValuePairs.first { it.key == "operationTo" }.value)
            assertEquals(1.5, updatedEvent.keyValuePairs.first { it.key == "daysTo" }.value)

            assertEquals(
                HttpStatusCode.NoContent,
                manager.delete("/api/v1/days-off/corrections/${created.id}").status,
            )
            val deletedEvent = appender.events.find { it.message == "days_off_correction.deleted" }
            assertNotNull(deletedEvent, "correction delete should be audited")
            assertEquals(created.id.toLong(), deletedEvent.keyValuePairs.first { it.key == "correctionId" }.value)
        } finally {
            appender.detach()
        }
    }
}
