package ch.nokillswit.integration

import ch.nokillswit.daysoff.DaysOffListFilter
import ch.nokillswit.daysoff.DaysOffStatus
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teams.TeamListFilter
import ch.nokillswit.users.UserListFilter
import ch.nokillswit.users.toResponse
import graphql.ErrorClassification
import graphql.ErrorType
import graphql.GraphQL
import graphql.GraphQLContext
import graphql.GraphQLError
import graphql.analysis.MaxQueryComplexityInstrumentation
import graphql.analysis.MaxQueryDepthInstrumentation
import graphql.execution.CoercedVariables
import graphql.execution.DataFetcherExceptionHandler
import graphql.execution.DataFetcherExceptionHandlerParameters
import graphql.execution.DataFetcherExceptionHandlerResult
import graphql.execution.instrumentation.ChainedInstrumentation
import graphql.language.IntValue
import graphql.language.SourceLocation
import graphql.language.Value
import graphql.schema.Coercing
import graphql.schema.CoercingParseLiteralException
import graphql.schema.CoercingParseValueException
import graphql.schema.CoercingSerializeException
import graphql.schema.DataFetchingEnvironment
import graphql.schema.GraphQLScalarType
import graphql.schema.idl.RuntimeWiring
import graphql.schema.idl.SchemaGenerator
import graphql.schema.idl.SchemaParser
import graphql.schema.idl.TypeRuntimeWiring
import io.ktor.server.plugins.BadRequestException
import java.util.Locale
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionException
import org.dataloader.DataLoader
import org.slf4j.LoggerFactory

// Query-shape guardrails: the deepest legitimate query is ~6 levels (users → items →
// performanceReviews → overall → summary), and a full bulk-sync selection is ~60–80 fields —
// both limits leave headroom while bounding recursion/abuse probes (→ 200 + GraphQL errors).
internal const val MAX_QUERY_DEPTH = 10
internal const val MAX_QUERY_COMPLEXITY = 300

private val integrationLogger = LoggerFactory.getLogger("ch.nokillswit.integration")

/** Schema-only build (no fetchers) — the same parser+scalar path production uses; backs the
 *  Docker-free IntegrationSchemaContractTest (parseability, read-only shape, documentation). */
fun parseIntegrationSchema(sdl: String): graphql.schema.GraphQLSchema =
    SchemaGenerator().makeExecutableSchema(
        SchemaParser().parse(sdl),
        RuntimeWiring.newRuntimeWiring().scalar(longScalar).build(),
    )

/** Builds the executable schema from the committed SDL (the contract — the runtime schema IS
 *  the file; IntegrationSchemaContractTest pins the round-trip) plus the guardrails. */
fun buildIntegrationGraphQL(sdl: String, services: IntegrationServices): GraphQL {
    val registry = SchemaParser().parse(sdl)
    val wiring = RuntimeWiring.newRuntimeWiring()
        .scalar(longScalar)
        .type("Query") { it.queryFetchers(services) }
        .type("User") { it.userFetchers() }
        .type("Team") { it.teamFetchers() }
        .type("TeamKpi") { it.dataFetcher("values") { env -> env.listLoader("valuesByKpi").load(env.parentId()) } }
        .type("DictionaryEntry") { it.dataFetcher("values", ::dictionaryValues) }
        .build()
    val schema = SchemaGenerator().makeExecutableSchema(registry, wiring)
    return GraphQL.newGraphQL(schema)
        .instrumentation(
            ChainedInstrumentation(
                listOf(
                    MaxQueryDepthInstrumentation(MAX_QUERY_DEPTH),
                    MaxQueryComplexityInstrumentation(MAX_QUERY_COMPLEXITY),
                ),
            ),
        )
        .defaultDataFetcherExceptionHandler(SanitizingExceptionHandler())
        .build()
}

// ── Root fields ─────────────────────────────────────────────────────────────────────────────

private fun TypeRuntimeWiring.Builder.queryFetchers(services: IntegrationServices): TypeRuntimeWiring.Builder = this
    .dataFetcher(
        "users",
        suspendFetcher { env ->
            val paging = env.pageRequest()
            val filter = UserListFilter(
                name = env.getArgument("name"),
                email = env.getArgument("email"),
                deactivated = env.getArgument("deactivated"),
            )
            // callerId is unused when callerSeesAllSeniority is true (no field blanking for
            // the trusted machine principal) — 0u is a placeholder, not an identity.
            val result = services.users.list(filter, paging, callerId = 0u, callerSeesAllSeniority = true)
            pageEnvelope(result.items.map { it.toGraphQL() }, paging, result.total)
        },
    )
    .dataFetcher(
        "user",
        suspendFetcher { env ->
            val id = requireNotNull(env.uintArgument("id"))
            val user = services.users.read(id) ?: return@suspendFetcher null
            val profile = services.users.careerProfilesByUserIds(setOf(id))[id]
            user.toResponse(id, profile).toGraphQL()
        },
    )
    .dataFetcher(
        "teams",
        suspendFetcher { env ->
            val paging = env.pageRequest()
            val result = services.teams.list(TeamListFilter(name = env.getArgument("name")), paging)
            pageEnvelope(result.items.map { it.toGraphQL() }, paging, result.total)
        },
    )
    .dataFetcher(
        "team",
        suspendFetcher { env ->
            val id = requireNotNull(env.uintArgument("id"))
            val detail = services.teams.readDetail(id) ?: return@suspendFetcher null
            // Hand-built map (TeamDetail is not @Serializable): UInt ids MUST become Long here.
            mapOf<String, Any?>(
                "id" to id.toLong(),
                "name" to detail.team.name,
                "managerId" to detail.team.managerId.toLong(),
                "managerName" to detail.managerName,
            )
        },
    )
    .dataFetcher(
        "reviewPeriods",
        suspendFetcher { _ -> services.reviewPeriods.list().map { it.toGraphQL() } },
    )
    .dataFetcher(
        "daysOff",
        suspendFetcher { env ->
            val paging = env.pageRequest()
            val filter = DaysOffListFilter(
                userId = env.uintArgument("userId"),
                status = env.enumArgument<DaysOffStatus>("status"),
                startDateGte = env.getArgument("from"),
                startDateLte = env.getArgument("to"),
            )
            val result = services.daysOff.listAllFull(filter, paging)
            pageEnvelope(result.items.map { it.toGraphQL() }, paging, result.total)
        },
    )
    .dataFetcher(
        "performanceReviews",
        suspendFetcher { env ->
            val paging = env.pageRequest()
            val result = services.reviews.listAllFull(
                periodId = env.uintArgument("periodId"),
                subordinateId = env.uintArgument("subordinateId"),
                paging = paging,
            )
            pageEnvelope(result.items.map { it.toGraphQL() }, paging, result.total)
        },
    )
    .dataFetcher(
        "teamKpis",
        suspendFetcher { env ->
            val paging = env.pageRequest()
            val result = services.teamKpis.listAllFull(
                teamId = env.uintArgument("teamId"),
                status = env.enumArgument<TeamKpiStatus>("status"),
                paging = paging,
            )
            pageEnvelope(result.items.map { it.toGraphQL() }, paging, result.total)
        },
    )

// ── Nested fields (DataLoader-backed — see DataLoaders.kt) ──────────────────────────────────

private fun TypeRuntimeWiring.Builder.userFetchers(): TypeRuntimeWiring.Builder = this
    .dataFetcher("careerHistory") { env -> env.listLoader("careerHistoryByUser").load(env.parentId()) }
    .dataFetcher("teams") { env -> env.listLoader("teamsByUser").load(env.parentId()) }
    .dataFetcher("performanceReviews") { env -> env.listLoader("reviewsBySubordinate").load(env.parentId()) }
    .dataFetcher("daysOff") { env ->
        env.yearScopedLoader("daysOffByUser").load(env.parentId() to env.getArgument<Int>("year"))
    }
    .dataFetcher("daysOffCorrections") { env ->
        env.yearScopedLoader("correctionsByUser").load(env.parentId() to env.getArgument<Int>("year"))
    }
    .dataFetcher("daysOffBudget") { env ->
        val loader: DataLoader<Pair<Long, Int>, Map<String, Any?>> = checkNotNull(env.getDataLoader("budgetByUserYear"))
        loader.load(env.parentId() to requireNotNull(env.getArgument<Int>("year")))
    }

private fun TypeRuntimeWiring.Builder.teamFetchers(): TypeRuntimeWiring.Builder = this
    .dataFetcher("manager") { env ->
        // Both team shapes (the TeamListItem map and the team(id) hand-built map) carry the
        // manager pair inline, so no loader is needed.
        val parent = checkNotNull(env.getSource<Map<String, Any?>>())
        mapOf<String, Any?>("id" to parent["managerId"], "name" to parent["managerName"])
    }
    .dataFetcher("members") { env -> env.listLoader("membersByTeam").load(env.parentId()) }
    .dataFetcher("kpis") { env -> env.listLoader("kpisByTeam").load(env.parentId()) }

/** DictionaryEntry.values: the serialized language→text map, flattened to the schema's list. */
private fun dictionaryValues(env: DataFetchingEnvironment): List<Map<String, Any?>> {
    val parent = checkNotNull(env.getSource<Map<String, Any?>>())
    val values = (parent["values"] as? Map<*, *>).orEmpty()
    return values.entries
        .sortedBy { it.key.toString() }
        .map { (language, value) -> mapOf<String, Any?>("language" to language.toString(), "value" to value) }
}

private fun DataFetchingEnvironment.parentId(): Long =
    (checkNotNull(getSource<Map<String, Any?>>())["id"] as Number).toLong()

private fun DataFetchingEnvironment.listLoader(name: String): DataLoader<Long, List<Map<String, Any?>>> =
    checkNotNull(getDataLoader(name)) { "DataLoader $name is not registered" }

private fun DataFetchingEnvironment.yearScopedLoader(
    name: String,
): DataLoader<Pair<Long, Int?>, List<Map<String, Any?>>> =
    checkNotNull(getDataLoader(name)) { "DataLoader $name is not registered" }

// ── Scalars & errors ────────────────────────────────────────────────────────────────────────

private val longScalar: GraphQLScalarType = GraphQLScalarType.newScalar()
    .name("Long")
    .description("64-bit signed integer (epoch-millisecond timestamps exceed 32-bit Int).")
    .coercing(LongCoercing)
    .build()

private object LongCoercing : Coercing<Long, Long> {
    override fun serialize(dataFetcherResult: Any, graphQLContext: GraphQLContext, locale: Locale): Long =
        (dataFetcherResult as? Number)?.toLong()
            ?: throw CoercingSerializeException("Expected a numeric Long value")

    override fun parseValue(input: Any, graphQLContext: GraphQLContext, locale: Locale): Long = when (input) {
        is Number -> input.toLong()
        is String -> input.toLongOrNull() ?: throw CoercingParseValueException("Expected a Long value")
        else -> throw CoercingParseValueException("Expected a Long value")
    }

    override fun parseLiteral(
        input: Value<*>,
        variables: CoercedVariables,
        graphQLContext: GraphQLContext,
        locale: Locale,
    ): Long = (input as? IntValue)?.value?.toLong()
        ?: throw CoercingParseLiteralException("Expected a Long literal")
}

/** A plain GraphQLError implementation — NOT GraphqlErrorBuilder: chaining that F-bounded
 *  wildcard builder crashes the Kotlin 2.4.10 frontend (StackOverflow in FIR substitution). */
private class SanitizedError(
    private val messageText: String,
    private val errorPath: List<Any>?,
    private val location: SourceLocation?,
) : GraphQLError {
    override fun getMessage(): String = messageText
    override fun getLocations(): List<SourceLocation> = listOfNotNull(location)
    override fun getErrorType(): ErrorClassification = ErrorType.DataFetchingException
    override fun getPath(): List<Any>? = errorPath
}

/**
 * Resolver failures → sanitized GraphQL errors (HTTP stays 200 per GraphQL-over-HTTP practice):
 * argument-validation [BadRequestException] messages pass through; anything unexpected is
 * logged server-side and surfaces as a bare "Internal error" (the MT-007 no-FQCN rule).
 */
internal class SanitizingExceptionHandler : DataFetcherExceptionHandler {
    override fun handleException(
        handlerParameters: DataFetcherExceptionHandlerParameters,
    ): CompletableFuture<DataFetcherExceptionHandlerResult> {
        val cause = unwrap(handlerParameters.exception)
        val message = if (cause is BadRequestException) {
            cause.message ?: "Bad request"
        } else {
            integrationLogger.error("Unhandled integration resolver failure", cause)
            "Internal error"
        }
        val error = SanitizedError(message, handlerParameters.path?.toList(), handlerParameters.sourceLocation)
        return CompletableFuture.completedFuture(
            DataFetcherExceptionHandlerResult.newResult().error(error).build(),
        )
    }

    private fun unwrap(exception: Throwable): Throwable =
        (exception as? CompletionException)?.cause ?: exception
}
