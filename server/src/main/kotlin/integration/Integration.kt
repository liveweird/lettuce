package ch.nokillswit.integration

import ch.nokillswit.audit.audit
import ch.nokillswit.auth.API_KEY_PREFIX
import ch.nokillswit.authz.UnauthorizedException
import ch.nokillswit.daysoff.DaysOffServiceKey
import ch.nokillswit.reviews.PerformanceReviewServiceKey
import ch.nokillswit.reviews.ReviewPeriodServiceKey
import ch.nokillswit.teamkpis.TeamKpiServiceKey
import ch.nokillswit.teams.TeamServiceKey
import ch.nokillswit.users.CareerPositionServiceKey
import ch.nokillswit.users.UserServiceKey
import graphql.ExecutionInput
import graphql.GraphQLContext
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.server.application.*
import io.ktor.server.plugins.ratelimit.RateLimitName
import io.ktor.server.plugins.ratelimit.rateLimit
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import java.util.function.Consumer
import kotlinx.coroutines.future.await
import kotlinx.coroutines.supervisorScope

/** The per-key RateLimit bucket name — registered in auth/AuthRoutes.kt's single install. */
const val INTEGRATION_RATE_LIMIT = "integration"

/**
 * The read-only integration API (v3.0.0): POST /integration/graphql + GET …/schema, mounted
 * OUTSIDE /api/v1 on purpose (its contract is the committed SDL, not documentation.yaml — the
 * OpenAPI conformance layer skips non-/api paths). Gated by `integration.enabled` (default
 * false): a disabled deployment registers NO routes, so the surface simply does not exist
 * (404). Authentication is an integration-client API key ([integrationCaller] — a guard-style
 * function like every authz guard, so failures ride StatusPages' ProblemDetail 401); resolvers
 * then read through the feature services with NO per-caller authorization — the deliberate
 * integration bypass (see .claude/docs/features/integration-api.md). Read-only by
 * construction: the schema declares no Mutation type.
 */
fun Application.configureIntegration() {
    val enabled = environment.config.propertyOrNull("integration.enabled")?.getString()?.toBoolean() == true
    if (!enabled) {
        log.info("Integration API disabled (integration.enabled=false) — /integration/graphql not registered")
        return
    }

    val clientService = attributes[IntegrationClientServiceKey]
    val services = IntegrationServices(
        users = attributes[UserServiceKey],
        careerPositions = attributes[CareerPositionServiceKey],
        teams = attributes[TeamServiceKey],
        daysOff = attributes[DaysOffServiceKey],
        reviews = attributes[PerformanceReviewServiceKey],
        reviewPeriods = attributes[ReviewPeriodServiceKey],
        teamKpis = attributes[TeamKpiServiceKey],
    )
    val sdl = checkNotNull(javaClass.getResource("/graphql/schema.graphqls")) {
        "graphql/schema.graphqls missing from the classpath"
    }.readText()
    val graphQL = buildIntegrationGraphQL(sdl, services)

    routing {
        rateLimit(RateLimitName(INTEGRATION_RATE_LIMIT)) {
            // The contract without a GraphQL client (introspection stays on for the rest).
            get("/integration/graphql/schema") {
                call.integrationCaller(clientService)
                call.respondText(sdl, ContentType.Text.Plain)
            }
            post("/integration/graphql") {
                val principal = call.integrationCaller(clientService)
                val body = call.receive<GraphQLHttpRequest>()
                // supervisorScope, not coroutineScope: fetcher/loader coroutines fail their
                // OWN CompletableFuture (graphql-java turns that into a GraphQL error via the
                // sanitizing handler) — under plain structured concurrency the first failing
                // child would cancel the request scope and escape as an HTTP-level error.
                // Cancellation still flows downward: a client disconnect cancels every child.
                val result = supervisorScope {
                    val scope = this
                    val contextEntries = Consumer<GraphQLContext.Builder> { it.put(SCOPE_CONTEXT_KEY, scope) }
                    graphQL.executeAsync(
                        ExecutionInput.newExecutionInput()
                            .query(body.query)
                            .operationName(body.operationName)
                            .variables(body.variables?.mapValues { (_, v) -> v.toAnyValue() } ?: emptyMap())
                            .graphQLContext(contextEntries)
                            .dataLoaderRegistry(newDataLoaderRegistry(services, scope))
                            .build(),
                    ).await()
                }
                val specification = result.toSpecification()
                audit(
                    "integration.request",
                    "clientId" to principal.clientId.toLong(),
                    "clientName" to principal.name,
                    "operationName" to body.operationName,
                    // The answered root fields (response keys) — never the query text/variables.
                    "rootFields" to ((specification["data"] as? Map<*, *>)?.keys?.joinToString(",") ?: ""),
                )
                // Executed documents always answer 200; query-level failures live in `errors`
                // (per GraphQL-over-HTTP practice). Transport errors (401/400) ride StatusPages.
                call.respond(specification.toJsonElement())
            }
        }
    }
}

/**
 * The integration guard (the authz/Guards.kt shape — a plain function, not an auth provider):
 * validates the `Authorization: Bearer lettuce_int_…` key against the non-revoked client
 * registry. Every failure mode is the SAME 401 (reasons live only in the audit trail — no
 * revoked-vs-unknown oracle); StatusPages turns the throw into a ProblemDetail body.
 */
private suspend fun ApplicationCall.integrationCaller(
    clients: IntegrationClientService,
): IntegrationClientPrincipal {
    val header = request.headers[HttpHeaders.Authorization]
    val token = header
        ?.takeIf { it.startsWith("Bearer ", ignoreCase = true) }
        ?.drop("Bearer ".length)
        ?.trim()
    if (token.isNullOrBlank() || !token.startsWith(API_KEY_PREFIX)) {
        audit("integration.auth_failed", "reason" to "missing_or_malformed")
        throw UnauthorizedException("Missing or invalid integration API key")
    }
    return clients.authenticate(token) ?: run {
        audit("integration.auth_failed", "reason" to "unknown_or_revoked")
        throw UnauthorizedException("Missing or invalid integration API key")
    }
}
