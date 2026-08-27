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

        val user = jsonClient().graphql(
            key,
            """{ user(id: ${ownerId.toInt()}) {
                 daysOff(year: 2062) { status type days userName }
                 daysOffBudget(year: 2062) { allowance reserved remaining }
                 daysOffCorrections { id } } }""",
        ).data()["user"]!!.jsonObject
        val request = user["daysOff"]!!.jsonArray.single().jsonObject
        assertEquals("REQUESTED", request["status"]!!.jsonPrimitive.content)
        assertEquals(restDays, request["days"]!!.jsonPrimitive.content.toDouble())
        val budget = user["daysOffBudget"]!!.jsonObject
        assertEquals(30, budget["allowance"]!!.jsonPrimitive.content.toInt())
        assertEquals(restDays, budget["reserved"]!!.jsonPrimitive.content.toDouble())

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
        // Depth 12 via introspection nesting — blocked by MaxQueryDepthInstrumentation(10).
        val deep = """{ __schema { types { fields { type { ofType { ofType { ofType { ofType {
            ofType { ofType { ofType { name } } } } } } } } } } } }"""
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
}
