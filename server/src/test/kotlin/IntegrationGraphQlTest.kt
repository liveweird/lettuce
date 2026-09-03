package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.integration.IntegrationClientCreateResponse
import ch.nokillswit.integration.IntegrationClientRequest
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.reviews.CategoryAssessment
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.reviews.PerformanceReviewResponse
import ch.nokillswit.teamkpis.TeamKpiCreateRequest
import ch.nokillswit.teamkpis.TeamKpiResponse
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teams.Team
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The read-only integration GraphQL API (v3.0.0): the config gate, the uniform API-key 401,
 * the deliberate authorization bypass (DRAFT reviews readable, content decrypted), nesting
 * through the DataLoader-backed fields, the REST-mirroring paging semantics, the query-shape
 * guardrails, and the transport-vs-GraphQL error split. Contract statics live in
 * IntegrationSchemaContractTest; key management in IntegrationClientTest.
 */
class IntegrationGraphQlTest {

    @Serializable
    private data class GqlBody(val query: String, val operationName: String? = null)

    private suspend fun HttpClient.graphql(key: String?, query: String, operationName: String? = null): HttpResponse =
        post("/integration/graphql") {
            contentType(ContentType.Application.Json)
            key?.let { header(HttpHeaders.Authorization, "Bearer $it") }
            setBody(GqlBody(query, operationName))
        }

    private suspend fun HttpResponse.data(): JsonObject {
        assertEquals(HttpStatusCode.OK, status)
        val root = body<JsonObject>()
        assertNull(root["errors"], "unexpected GraphQL errors: ${root["errors"]}")
        return root["data"]!!.jsonObject
    }

    private suspend fun HttpResponse.expectGraphQlError(): String {
        assertEquals(HttpStatusCode.OK, status)
        val errors = body<JsonObject>()["errors"]?.jsonArray
        assertTrue(!errors.isNullOrEmpty(), "expected a GraphQL error")
        return errors.joinToString { it.jsonObject["message"]!!.jsonPrimitive.content }
    }

    private suspend fun ApplicationTestBuilder.enabledApp() {
        configureApp("integration.enabled" to "true")
        startApplication()
    }

    /** Seeds an admin and mints a fresh integration API key through the management REST API. */
    private suspend fun ApplicationTestBuilder.freshKey(prefix: String): Pair<HttpClient, String> {
        val adminEmail = uniqueEmail("$prefix-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val created = admin.post("/api/v1/integration-clients") {
            contentType(ContentType.Application.Json)
            setBody(IntegrationClientRequest(name = "$prefix-${UUID.randomUUID()}"))
        }.body<IntegrationClientCreateResponse>()
        return admin to created.apiKey
    }

    @Test
    fun `the endpoint does not exist while integration is disabled (the default)`() = testApplication {
        usePostgresTestcontainer()
        val plain = jsonClient()
        assertEquals(HttpStatusCode.NotFound, plain.graphql(null, "{ reviewPeriods { id } }").status)
        assertEquals(HttpStatusCode.NotFound, plain.get("/integration/graphql/schema").status)
    }

    @Test
    fun `every bad-key shape answers the same 401 problem`() = testApplication {
        enabledApp()
        val (admin, key) = freshKey("gql-auth")
        val plain = jsonClient()
        val query = "{ reviewPeriods { id } }"

        for (bad in listOf(null, "not-a-key", "lettuce_int_definitely-not-issued-0123456789012345678")) {
            val response = plain.graphql(bad, query)
            assertEquals(HttpStatusCode.Unauthorized, response.status)
            assertEquals("Missing or invalid integration API key", response.body<ProblemDetail>().detail)
        }

        // Exactly ONE Authorization header is accepted (checkup #30, A-L9)…
        val doubled = plain.post("/integration/graphql") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Authorization, "Bearer $key")
            header(HttpHeaders.Authorization, "Bearer $key")
            setBody(GqlBody(query))
        }
        assertEquals(HttpStatusCode.Unauthorized, doubled.status)
        // …while scheme case is normalized (the guard and the rate-limit key share one parse).
        val lowercase = plain.post("/integration/graphql") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Authorization, "bearer $key")
            setBody(GqlBody(query))
        }
        assertEquals(HttpStatusCode.OK, lowercase.status)

        // A revoked key stops authenticating immediately — same uniform 401.
        assertEquals(HttpStatusCode.OK, plain.graphql(key, query).status)
        val clientId = admin.get("/api/v1/integration-clients")
            .body<ch.nokillswit.integration.IntegrationClientListResponse>()
            .items.last().id
        admin.post("/api/v1/integration-clients/$clientId/revoke")
        assertEquals(HttpStatusCode.Unauthorized, plain.graphql(key, query).status)
    }

    @Test
    fun `users, teams, and nested membership read through the graph`() = testApplication {
        enabledApp()
        val (_, key) = freshKey("gql-users")
        val managerEmail = uniqueEmail("gql-manager")
        val memberEmail = uniqueEmail("gql-member")
        val managerId = TestUsers.seed(managerEmail, "pw", name = "Gql Manager", roles = emptySet())
        val memberId = TestUsers.seed(memberEmail, "pw", name = "Gql Member", roles = emptySet())
        val teamName = "gql-team-${UUID.randomUUID()}"
        val teamId = TestServices.teams.create(Team(name = teamName, managerId = managerId))
        TestServices.teams.addMember(teamId, memberId)
        val plain = jsonClient()

        val users = plain.graphql(
            key,
            """{ users(email: "$memberEmail") {
                 items { id name email roles deactivated uniqueId teams { name } careerHistory { id } }
                 page pageSize total } }""",
        ).data()["users"]!!.jsonObject
        assertEquals(1, users["total"]!!.jsonPrimitive.content.toInt())
        val row = users["items"]!!.jsonArray.single().jsonObject
        assertEquals(memberId.toInt(), row["id"]!!.jsonPrimitive.content.toInt())
        assertEquals("Gql Member", row["name"]!!.jsonPrimitive.content)
        assertEquals(0, row["roles"]!!.jsonArray.size)
        assertEquals(
            teamName,
            row["teams"]!!.jsonArray.single().jsonObject["name"]!!.jsonPrimitive.content,
        )
        assertEquals(0, row["careerHistory"]!!.jsonArray.size)

        val team = plain.graphql(
            key,
            """{ team(id: ${teamId.toInt()}) { name manager { id name } members { id name } kpis { id } } }""",
        ).data()["team"]!!.jsonObject
        assertEquals(teamName, team["name"]!!.jsonPrimitive.content)
        assertEquals("Gql Manager", team["manager"]!!.jsonObject["name"]!!.jsonPrimitive.content)
        assertEquals(
            "Gql Member",
            team["members"]!!.jsonArray.single().jsonObject["name"]!!.jsonPrimitive.content,
        )
        assertEquals(0, team["kpis"]!!.jsonArray.size)
    }

    @Test
    fun `a DRAFT review is readable with decrypted content — the deliberate bypass`() = testApplication {
        enabledApp()
        val (_, key) = freshKey("gql-review")
        val managerEmail = uniqueEmail("gql-rev-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("gql-rev-sub"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(
            Team(name = "gql-rev-${UUID.randomUUID()}", managerId = managerId),
        )
        TestServices.teams.addMember(teamId, subordinateId)
        val period = TestReviewPeriods.append()
        val manager = authedClient(managerEmail, "pw")
        val secret = "Integration-visible summary ${UUID.randomUUID()}"
        val created = manager.post("/api/v1/performance-reviews") {
            contentType(ContentType.Application.Json)
            setBody(
                PerformanceReviewCreateRequest(
                    subordinateId = subordinateId,
                    periodId = period.id,
                    attitude = CategoryAssessment(2, secret),
                ),
            )
        }.body<PerformanceReviewResponse>()

        val reviews = jsonClient().graphql(
            key,
            """{ performanceReviews(subordinateId: ${subordinateId.toInt()}) {
                 items { id status attitude { rating summary } overall { rating summary } subordinateName }
                 total } }""",
        ).data()["performanceReviews"]!!.jsonObject
        val item = reviews["items"]!!.jsonArray.single().jsonObject
        assertEquals(created.id.toInt(), item["id"]!!.jsonPrimitive.content.toInt())
        // DRAFT — invisible to everyone but its author under the product rules; the
        // integration principal reads it decrypted (the documented bypass).
        assertEquals("DRAFT", item["status"]!!.jsonPrimitive.content)
        assertEquals(2, item["attitude"]!!.jsonObject["rating"]!!.jsonPrimitive.content.toInt())
        assertEquals(secret, item["attitude"]!!.jsonObject["summary"]!!.jsonPrimitive.content)
        assertTrue(item["overall"]!!.jsonObject["rating"] is kotlinx.serialization.json.JsonNull)

        // The registry root sees the period.
        val periods = jsonClient().graphql(key, "{ reviewPeriods { id startMonth endMonth } }")
            .data()["reviewPeriods"]!!.jsonArray
        assertNotNull(periods.find { it.jsonObject["id"]!!.jsonPrimitive.content.toInt() == period.id.toInt() })
    }

    @Test
    fun `team KPIs decrypt and nest their data points`() = testApplication {
        enabledApp()
        val (_, key) = freshKey("gql-kpi")
        val managerEmail = uniqueEmail("gql-kpi-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val teamId = TestServices.teams.create(
            Team(name = "gql-kpi-${UUID.randomUUID()}", managerId = managerId),
        )
        val manager = authedClient(managerEmail, "pw")
        val secretDescription = "Integration KPI description ${UUID.randomUUID()}"
        val kpi = manager.post("/api/v1/team-kpis") {
            contentType(ContentType.Application.Json)
            setBody(
                TeamKpiCreateRequest(
                    teamId = teamId,
                    title = "Gql KPI",
                    description = secretDescription,
                    type = TeamKpiType.NUMBER,
                    targetValue = 10.0,
                ),
            )
        }.body<TeamKpiResponse>()
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/team-kpis/${kpi.id}/activate").status)
        val valueResponse = manager.post("/api/v1/team-kpis/${kpi.id}/values") {
            contentType(ContentType.Application.Json)
            // A PAST measurement date — future-dated data points are rejected.
            setBody(ch.nokillswit.teamkpis.TeamKpiValueWrite(date = "2026-01-15", value = 4.0))
        }
        assertEquals(HttpStatusCode.Created, valueResponse.status)

        // The Team parent chains kpisByTeam -> valuesByKpi — the only loader-feeds-loader path
        // (checkup #30 test gap 6).
        val nested = jsonClient().graphql(
            key,
            """{ team(id: ${teamId.toInt()}) { kpis { title values { value } } } }""",
        ).data()["team"]!!.jsonObject
        val nestedKpi = nested["kpis"]!!.jsonArray.single().jsonObject
        assertEquals("Gql KPI", nestedKpi["title"]!!.jsonPrimitive.content)
        assertEquals(4.0, nestedKpi["values"]!!.jsonArray.single().jsonObject["value"]!!.jsonPrimitive.content.toDouble())

        val kpis = jsonClient().graphql(
            key,
            """{ teamKpis(teamId: ${teamId.toInt()}) {
                 items { title description status currentValue values { date value } } total } }""",
        ).data()["teamKpis"]!!.jsonObject
        val item = kpis["items"]!!.jsonArray.single().jsonObject
        assertEquals(secretDescription, item["description"]!!.jsonPrimitive.content)
        assertEquals(4.0, item["currentValue"]!!.jsonPrimitive.content.toDouble())
        val value = item["values"]!!.jsonArray.single().jsonObject
        assertEquals("2026-01-15", value["date"]!!.jsonPrimitive.content)
    }

    @Test
    fun `days off and budgets read through user nesting and the bulk root`() = testApplication {
        enabledApp()
        val (_, key) = freshKey("gql-daysoff")
        val ownerEmail = uniqueEmail("gql-do-owner")
        val ownerId = TestUsers.seed(ownerEmail, "pw", roles = emptySet())
        TestDaysOff.setAllowance(ownerId, 30)
        val owner = authedClient(ownerEmail, "pw")
        val start = LocalDate.of(2062, 6, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY))
        val created = owner.post("/api/v1/days-off") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffCreateRequest(DaysOffType.PAID, start.toString(), start.plusDays(1).toString()))
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val restDays = created.body<ch.nokillswit.daysoff.DaysOffResponse>().days

        // An extra pool (v3.2.0) must not displace the default one on the single-budget field.
        val extraKind = TestDaysOff.createPoolType("gql-extra")
        TestDaysOff.setAllowance(ownerId, 5, poolTypeId = extraKind)

        val user = jsonClient().graphql(
            key,
            """{ user(id: ${ownerId.toInt()}) {
                 daysOff(year: 2062) { status type poolTypeId poolName days userName }
                 daysOffBudget(year: 2062) { allowance reserved remaining isDefault poolName carriesOver }
                 daysOffBudgets(year: 2062) { poolTypeId allowance isDefault }
                 daysOffCorrections { id poolTypeId } } }""",
        ).data()["user"]!!.jsonObject
        val request = user["daysOff"]!!.jsonArray.single().jsonObject
        assertEquals("REQUESTED", request["status"]!!.jsonPrimitive.content)
        assertEquals(restDays, request["days"]!!.jsonPrimitive.content.toDouble())
        assertEquals(1, request["poolTypeId"]!!.jsonPrimitive.content.toInt())
        assertEquals("Paid days off", request["poolName"]!!.jsonPrimitive.content)
        val budget = user["daysOffBudget"]!!.jsonObject
        assertEquals(30, budget["allowance"]!!.jsonPrimitive.content.toInt())
        assertEquals(restDays, budget["reserved"]!!.jsonPrimitive.content.toDouble())
        assertEquals(true, budget["isDefault"]!!.jsonPrimitive.content.toBoolean())
        assertEquals(true, budget["carriesOver"]!!.jsonPrimitive.content.toBoolean())
        val budgets = user["daysOffBudgets"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf(true, false), budgets.map { it["isDefault"]!!.jsonPrimitive.content.toBoolean() })
        assertEquals(5, budgets[1]["allowance"]!!.jsonPrimitive.content.toInt())
        assertEquals(extraKind.toInt(), budgets[1]["poolTypeId"]!!.jsonPrimitive.content.toInt())
        // The registry root lists the seeded default first.
        val kinds = jsonClient().graphql(key, "{ daysOffPoolTypes { id name carriesOver isDefault } }")
            .data()["daysOffPoolTypes"]!!.jsonArray.map { it.jsonObject }
        assertEquals(true, kinds.first()["isDefault"]!!.jsonPrimitive.content.toBoolean())
        assertTrue(kinds.any { it["id"]!!.jsonPrimitive.content.toInt() == extraKind.toInt() })

        // The bulk root sees the same request under its filters.
        val bulk = jsonClient().graphql(
            key,
            """{ daysOff(userId: ${ownerId.toInt()}, status: REQUESTED, from: "2062-01-01", to: "2062-12-31") {
                 items { userName days } total } }""",
        ).data()["daysOff"]!!.jsonObject
        assertEquals(1, bulk["total"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `paging arguments follow the REST semantics`() = testApplication {
        enabledApp()
        val (_, key) = freshKey("gql-paging")
        val plain = jsonClient()
        assertTrue("pageSize" in plain.graphql(key, "{ users(pageSize: 0) { total } }").expectGraphQlError())
        assertTrue("pageSize" in plain.graphql(key, "{ users(pageSize: 101) { total } }").expectGraphQlError())
        assertTrue("page" in plain.graphql(key, "{ users(page: 0) { total } }").expectGraphQlError())
        // Defaults echo back through the envelope.
        val page = plain.graphql(key, "{ teams { page pageSize } }").data()["teams"]!!.jsonObject
        assertEquals(1, page["page"]!!.jsonPrimitive.content.toInt())
        assertEquals(20, page["pageSize"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `query-shape guardrails and unknown fields fail as GraphQL errors`() = testApplication {
        enabledApp()
        val (_, key) = freshKey("gql-guard")
        val plain = jsonClient()
        // Depth 17 via introspection nesting — blocked by MaxQueryDepthInstrumentation(15)
        // (the limit sits ABOVE the standard introspection query's depth 12 — checkup #30, A-H2).
        val deep = """{ __schema { types { fields { type { ofType { ofType { ofType { ofType {
            ofType { ofType { ofType { ofType { ofType { ofType { ofType { ofType {
            name } } } } } } } } } } } } } } } } }"""
        assertTrue("depth" in plain.graphql(key, deep).expectGraphQlError().lowercase())
        // Unknown fields are validation errors (200 + errors), never a transport failure.
        plain.graphql(key, "{ users { items { passwordHash } } }").expectGraphQlError()
        // A malformed DOCUMENT is still a valid transport request.
        plain.graphql(key, "{ users {").expectGraphQlError()
    }

    @Test
    fun `malformed JSON is a transport 400 problem`() = testApplication {
        enabledApp()
        val (_, key) = freshKey("gql-transport")
        val response = jsonClient().post("/integration/graphql") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Authorization, "Bearer $key")
            setBody("{ not json")
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals(
            "Request body is invalid or does not match the expected schema",
            response.body<ProblemDetail>().detail,
        )
    }

    @Test
    fun `the SDL is served to authenticated clients and requests are audited`() = testApplication {
        enabledApp()
        val (_, key) = freshKey("gql-sdl")
        val plain = jsonClient()
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val schema = plain.get("/integration/graphql/schema") {
                header(HttpHeaders.Authorization, "Bearer $key")
            }
            assertEquals(HttpStatusCode.OK, schema.status)
            assertTrue("type Query" in schema.bodyAsText())
            assertEquals(HttpStatusCode.Unauthorized, plain.get("/integration/graphql/schema").status)

            plain.graphql(key, "query Sync { reviewPeriods { id } teams { total } }", operationName = "Sync").data()
            val event = appender.events.find { it.message == "integration.request" }
            assertNotNull(event, "expected an integration.request audit event")
            assertTrue(event.hasKeyValue("operationName", "Sync"))
            assertTrue(event.hasKeyValue("rootFields", "reviewPeriods,teams"))
            // The audit trail carries root fields only — never the query text.
            assertTrue(appender.events.none { e -> e.keyValuePairs?.any { "query Sync" in it.value.toString() } == true })
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `the standard introspection query succeeds within the guardrails`() = testApplication {
        // Checkup #30, A-H2: the contract promises introspection-based discovery, and the
        // canonical query nests ofType seven deep (depth 12) — the old depth-10 limit broke it.
        enabledApp()
        val (_, key) = freshKey("gql-introspect")
        val data = jsonClient().graphql(key, graphql.introspection.IntrospectionQuery.INTROSPECTION_QUERY).data()
        val types = data["__schema"]!!.jsonObject["types"]!!.jsonArray
        assertTrue(types.any { it.jsonObject["name"]?.jsonPrimitive?.content == "User" })
    }

    @Test
    fun `alias fan-outs past the pageSize-weighted complexity budget are rejected`() = testApplication {
        // Checkup #30, A-M5: the default calculator ignored pageSize, so 100-row pages carrying
        // year-alias fan-outs multiplied the DataLoader work far past the flat budget's intent.
        enabledApp()
        val (_, key) = freshKey("gql-complexity")
        val plain = jsonClient()
        val aliases = (0 until 120).joinToString(" ") { "a$it: daysOffBudget(year: ${2000 + (it % 100)}) { remaining }" }
        val bomb = "{ users(pageSize: 100) { items { $aliases } } }"
        assertTrue("complexity" in plain.graphql(key, bomb).expectGraphQlError().lowercase())
        // A wide single-pass bulk-sync selection stays affordable.
        val wide = """{ users(pageSize: 100) { total items {
            id name email uniqueId roles deactivated language
            careerHistory { startDate endDate }
            teams { id name }
            daysOff(year: 2062) { status days }
            daysOffBudget(year: 2062) { allowance remaining }
            performanceReviews { status attitude { rating } } } } }"""
        plain.graphql(key, wide).data()
    }

    @Test
    fun `date and year bounds are validated like the REST API`() = testApplication {
        // Checkup #30, B-H1 + A-M4: unvalidated bounds either silently dropped rows
        // (lexicographic VARCHAR compare) or overflowed the closed-form budget math.
        enabledApp()
        val (_, key) = freshKey("gql-bounds")
        val plain = jsonClient()
        assertTrue("from" in plain.graphql(key, """{ daysOff(from: "2026-1-1") { total } }""").expectGraphQlError())
        assertTrue("to" in plain.graphql(key, """{ daysOff(to: "garbage") { total } }""").expectGraphQlError())
        assertTrue("year" in plain.graphql(key, "{ user(id: 1) { daysOff(year: 1999) { status } } }").expectGraphQlError())
        assertTrue(
            "year" in plain.graphql(key, "{ user(id: 1) { daysOffBudget(year: 2147483647) { remaining } } }")
                .expectGraphQlError(),
        )
    }

    @Test
    fun `variables flow through and lenient tokens cannot crash the transport`() = testApplication {
        enabledApp()
        val (_, key) = freshKey("gql-vars")
        val email = uniqueEmail("gql-vars-user")
        TestUsers.seed(email, "pw", roles = emptySet())
        val plain = jsonClient()

        // The declared-variable path (the JsonObject -> toAnyValue bridge).
        val withVars = plain.post("/integration/graphql") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Authorization, "Bearer $key")
            setBody("""{"query":"query U(${'$'}email: String) { users(email: ${'$'}email) { total } }","variables":{"email":"$email"}}""")
        }
        assertEquals(HttpStatusCode.OK, withVars.status)
        val total = withVars.body<JsonObject>()["data"]!!.jsonObject["users"]!!.jsonObject["total"]!!
        assertEquals(1, total.jsonPrimitive.content.toInt())

        // Checkup #30, A-M3: the lenient default Json accepts an unquoted token as a non-string
        // primitive — pre-fix this crashed the number fallback into a transport 500.
        val lenient = plain.post("/integration/graphql") {
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Authorization, "Bearer $key")
            setBody("""{"query":"{ reviewPeriods { id } }","variables":{"x":abc}}""")
        }
        assertEquals(HttpStatusCode.OK, lenient.status)
    }

    @Test
    fun `user nesting resolves teams, career history, and dictionary translations`() = testApplication {
        // Checkup #30 test gaps 1 + 7: careerHistory with REAL rows (derived end dates + the
        // DictionaryValue map->list flattening) and User.teams under the single-user root,
        // where the serialized map has NO teams key and only the loader wiring can answer.
        enabledApp()
        val (_, key) = freshKey("gql-career")
        val managerEmail = uniqueEmail("gql-cr-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val memberId = TestUsers.seed(uniqueEmail("gql-cr-member"), "pw", roles = emptySet())
        val teamName = "gql-cr-${UUID.randomUUID()}"
        val teamId = TestServices.teams.create(ch.nokillswit.teams.Team(name = teamName, managerId = managerId))
        TestServices.teams.addMember(teamId, memberId)
        val marker = UUID.randomUUID().toString().take(8)
        val pathId = TestDictionaries.append(ch.nokillswit.dictionaries.Dictionary.CAREER_PATH, "GqlPath $marker").single()
        val specId = TestDictionaries
            .append(ch.nokillswit.dictionaries.Dictionary.CAREER_SPECIALIZATION, "GqlSpec $marker").single()
        // Two DISTINCT levels — a position repeating its neighbor's exact triple is 409
        // (the adjacent-sameness rule).
        val levelIds = TestDictionaries
            .append(ch.nokillswit.dictionaries.Dictionary.SENIORITY_LEVEL, "GqlLevelA $marker", "GqlLevelB $marker")
        val manager = authedClient(managerEmail, "pw")
        for ((start, levelId) in listOf("1990-01-01" to levelIds[0], "1995-06-01" to levelIds[1])) {
            assertEquals(
                HttpStatusCode.Created,
                manager.post("/api/v1/users/$memberId/career-positions") {
                    contentType(ContentType.Application.Json)
                    setBody(ch.nokillswit.users.CareerPositionWrite(start, pathId, specId, levelId))
                }.status,
            )
        }

        val user = jsonClient().graphql(
            key,
            """{ user(id: ${memberId.toInt()}) {
                 teams { name }
                 careerHistory { startDate endDate careerPath { values { language value } } } } }""",
        ).data()["user"]!!.jsonObject
        assertEquals(teamName, user["teams"]!!.jsonArray.single().jsonObject["name"]!!.jsonPrimitive.content)
        val history = user["careerHistory"]!!.jsonArray
        assertEquals(listOf("1990-01-01", "1995-06-01"), history.map { it.jsonObject["startDate"]!!.jsonPrimitive.content })
        // The derived-end model: first row ends the day before the next starts; the current row is open.
        assertEquals("1995-05-31", history[0].jsonObject["endDate"]!!.jsonPrimitive.content)
        assertTrue(history[1].jsonObject["endDate"] is kotlinx.serialization.json.JsonNull)
        val pathValues = history[1].jsonObject["careerPath"]!!.jsonObject["values"]!!.jsonArray
        val en = pathValues.single { it.jsonObject["language"]!!.jsonPrimitive.content == "en" }
        assertEquals("GqlPath $marker", en.jsonObject["value"]!!.jsonPrimitive.content)
    }

    @Test
    fun `encrypted cancel reasons, corrections, and nested reviews decrypt through the graph`() = testApplication {
        // Checkup #30 test gaps 4 + 5: the two remaining encrypted columns (cancel_reason,
        // correction comment) and the reviewsBySubordinate loader never ran through the graph.
        enabledApp()
        val (_, key) = freshKey("gql-decrypt")
        val managerEmail = uniqueEmail("gql-de-manager")
        val ownerEmail = uniqueEmail("gql-de-owner")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val ownerId = TestUsers.seed(ownerEmail, "pw", roles = emptySet())
        val teamId = TestServices.teams.create(
            ch.nokillswit.teams.Team(name = "gql-de-${UUID.randomUUID()}", managerId = managerId),
        )
        TestServices.teams.addMember(teamId, ownerId)
        TestDaysOff.setAllowance(ownerId, 30)
        val manager = authedClient(managerEmail, "pw")
        val owner = authedClient(ownerEmail, "pw")

        val start = LocalDate.of(2063, 6, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY))
        val requestId = owner.post("/api/v1/days-off") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffCreateRequest(DaysOffType.PAID, start.toString(), start.plusDays(1).toString()))
        }.body<ch.nokillswit.daysoff.DaysOffResponse>().id
        val cancelSecret = "Gql cancel secret ${UUID.randomUUID()}"
        assertEquals(
            HttpStatusCode.NoContent,
            owner.post("/api/v1/days-off/$requestId/cancel") {
                contentType(ContentType.Application.Json)
                setBody(ch.nokillswit.daysoff.DaysOffCancelRequest(cancelSecret))
            }.status,
        )
        val correctionSecret = "Gql correction secret ${UUID.randomUUID()}"
        assertEquals(
            HttpStatusCode.Created,
            manager.post("/api/v1/days-off/corrections") {
                contentType(ContentType.Application.Json)
                setBody(
                    ch.nokillswit.daysoff.DaysOffCorrectionWrite(
                        ownerId, 2063, ch.nokillswit.daysoff.DaysOffCorrectionOperation.ADD, 1.5, correctionSecret,
                    ),
                )
            }.status,
        )
        val period = TestReviewPeriods.append()
        val reviewSecret = "Gql review secret ${UUID.randomUUID()}"
        assertEquals(
            HttpStatusCode.Created,
            manager.post("/api/v1/performance-reviews") {
                contentType(ContentType.Application.Json)
                setBody(
                    PerformanceReviewCreateRequest(
                        subordinateId = ownerId,
                        periodId = period.id,
                        attitude = CategoryAssessment(3, reviewSecret),
                    ),
                )
            }.status,
        )

        val user = jsonClient().graphql(
            key,
            """{ user(id: ${ownerId.toInt()}) {
                 daysOff(year: 2063) { status cancelReason cancelledByName }
                 daysOffCorrections(year: 2063) { operation days comment }
                 performanceReviews { status attitude { rating summary } } } }""",
        ).data()["user"]!!.jsonObject
        val request = user["daysOff"]!!.jsonArray.single().jsonObject
        assertEquals("CANCELLED", request["status"]!!.jsonPrimitive.content)
        assertEquals(cancelSecret, request["cancelReason"]!!.jsonPrimitive.content)
        val correction = user["daysOffCorrections"]!!.jsonArray.single().jsonObject
        assertEquals("ADD", correction["operation"]!!.jsonPrimitive.content)
        assertEquals(correctionSecret, correction["comment"]!!.jsonPrimitive.content)
        val review = user["performanceReviews"]!!.jsonArray.single().jsonObject
        assertEquals("DRAFT", review["status"]!!.jsonPrimitive.content)
        assertEquals(reviewSecret, review["attitude"]!!.jsonObject["summary"]!!.jsonPrimitive.content)
    }

    @Test
    fun `missing and soft-deleted teams resolve to null`() = testApplication {
        enabledApp()
        val (admin, key) = freshKey("gql-nullteam")
        val plain = jsonClient()
        assertTrue(plain.graphql(key, "{ team(id: 999999999) { name } }").data()["team"] is kotlinx.serialization.json.JsonNull)
        val managerId = TestUsers.seed(uniqueEmail("gql-nt-manager"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(
            ch.nokillswit.teams.Team(name = "gql-nt-${UUID.randomUUID()}", managerId = managerId),
        )
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/teams/$teamId").status)
        assertTrue(plain.graphql(key, "{ team(id: ${teamId.toInt()}) { name } }").data()["team"] is kotlinx.serialization.json.JsonNull)
    }

    @Test
    fun `root filters and paging compose`() = testApplication {
        enabledApp()
        val (admin, key) = freshKey("gql-filters")
        val base = "gql-flt-${UUID.randomUUID()}"
        val activeId = TestUsers.seed("$base-a@test", "pw", roles = emptySet())
        val dormantId = TestUsers.seed("$base-b@test", "pw", roles = emptySet())
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$dormantId/deactivate").status)
        val teamName = "gql-flt-team-${UUID.randomUUID()}"
        val managerId = TestUsers.seed(uniqueEmail("gql-flt-mgr"), "pw", roles = emptySet())
        TestServices.teams.create(ch.nokillswit.teams.Team(name = teamName, managerId = managerId))
        val plain = jsonClient()

        val deactivated = plain.graphql(key, """{ users(email: "$base", deactivated: true) { items { id } total } }""")
            .data()["users"]!!.jsonObject
        assertEquals(
            listOf(dormantId.toInt()),
            deactivated["items"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content.toInt() },
        )
        // The paging offset math: page 2 of size 1 under the same filter is the second id.
        val page2 = plain.graphql(key, """{ users(email: "$base", pageSize: 1, page: 2) { items { id } total } }""")
            .data()["users"]!!.jsonObject
        assertEquals(2, page2["total"]!!.jsonPrimitive.content.toInt())
        assertEquals(
            listOf(maxOf(activeId.toInt(), dormantId.toInt())),
            page2["items"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content.toInt() },
        )
        val teams = plain.graphql(key, """{ teams(name: "$teamName") { total items { name } } }""")
            .data()["teams"]!!.jsonObject
        assertEquals(1, teams["total"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `the sanitizing handler passes validation messages and hides everything else`() {
        // GQL-ERR-002's mechanical pin (checkup #30, B-M4): the "Internal error" branch was
        // otherwise unreachable from the route tests — precisely because the resolvers guard
        // their inputs — so it is exercised at the unit level.
        val env = graphql.schema.DataFetchingEnvironmentImpl.newDataFetchingEnvironment()
            .executionStepInfo(
                graphql.execution.ExecutionStepInfo.newExecutionStepInfo()
                    .type(graphql.Scalars.GraphQLString)
                    .path(graphql.execution.ResultPath.parse("/probe"))
                    .build(),
            )
            .mergedField(
                graphql.execution.MergedField.newMergedField(
                    graphql.language.Field.newField("probe").build(),
                ).build(),
            )
            .build()
        val handler = ch.nokillswit.integration.SanitizingExceptionHandler()
        fun messageFor(e: Throwable): String {
            val params = graphql.execution.DataFetcherExceptionHandlerParameters.newExceptionParameters()
                .dataFetchingEnvironment(env)
                .exception(e)
                .build()
            return handler.handleException(params).get().errors.single().message
        }
        assertEquals("bad arg", messageFor(io.ktor.server.plugins.BadRequestException("bad arg")))
        assertEquals(
            "bad arg",
            messageFor(java.util.concurrent.CompletionException(io.ktor.server.plugins.BadRequestException("bad arg"))),
        )
        assertEquals("Internal error", messageFor(IllegalStateException("secret-internal-detail")))
    }
}
