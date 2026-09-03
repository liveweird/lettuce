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
import graphql.analysis.FieldComplexityCalculator
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

// Query-shape guardrails (recalibrated in checkup #30 — A-H2/A-M5): depth 15 because the
// STANDARD introspection query nests `ofType` seven deep (total depth 12) and the contract
// promises introspection works — 10 rejected it; complexity 1000 with a pageSize-weighted
// calculator (a paged field multiplies its subtree by ceil(pageSize/20), an unresolvable
// pageSize — a variable — charges the worst case) so a wide single-pass bulk sync fits while
// alias fan-outs that would amplify the year-scoped DataLoaders are rejected. Violations
// answer 200 + GraphQL errors.
internal const val MAX_QUERY_DEPTH = 15
internal const val MAX_QUERY_COMPLEXITY = 1000
private const val PAGE_FACTOR_UNIT = 20
private const val MAX_PAGE_FACTOR = 5

private val integrationLogger = LoggerFactory.getLogger("ch.nokillswit.integration")

/** Complexity that scales with the requested page size (checkup #30, A-M5): the default
 *  calculator charges `users(pageSize: 100)` like `users(pageSize: 1)`, letting alias fan-outs
 *  multiply the year-scoped DataLoader work far past what the flat budget implies. A paged
 *  field multiplies its subtree by ceil(pageSize/20), capped at 5 (= max 100 / default 20);
 *  a pageSize the analyzer cannot read (a variable) charges the cap. */
private val pageSizeWeightedComplexity = FieldComplexityCalculator { env, childComplexity ->
    val pageSizeValue = env.field.arguments.firstOrNull { it.name == "pageSize" }?.value
    val factor = when (pageSizeValue) {
        null -> 1
        is IntValue -> {
            val size = runCatching { pageSizeValue.value.intValueExact() }.getOrDefault(Int.MAX_VALUE)
            ((size.toLong() + PAGE_FACTOR_UNIT - 1) / PAGE_FACTOR_UNIT).coerceIn(1L, MAX_PAGE_FACTOR.toLong()).toInt()
        }
        else -> MAX_PAGE_FACTOR
    }
    factor * (childComplexity + 1)
}

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
                    MaxQueryComplexityInstrumentation(MAX_QUERY_COMPLEXITY, pageSizeWeightedComplexity),
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
            val id = requireNotNull(env.uintArgument("id")) { "id is non-null in the schema" }
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
            val id = requireNotNull(env.uintArgument("id")) { "id is non-null in the schema" }
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
        "daysOffPoolTypes",
        suspendFetcher { _ -> services.daysOff.listPoolTypes().map { it.toGraphQL() } },
    )
    .dataFetcher(
        "daysOff",
        suspendFetcher { env ->
            val paging = env.pageRequest()
            val filter = DaysOffListFilter(
                userId = env.uintArgument("userId"),
                status = env.enumArgument<DaysOffStatus>("status"),
                startDateGte = env.isoDateArgument("from"),
                startDateLte = env.isoDateArgument("to"),
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
    .dataFetcher("teams") { env ->
        // The users LIST rows already carry the teams enrichment (UserService.list) — reuse it
        // instead of a second team query; the single-user map omits the key (EncodeDefault
        // NEVER), so user(id) parents still batch through the loader (checkup #30, A-L5).
        checkNotNull(env.getSource<Map<String, Any?>>())["teams"]
            ?: env.listLoader("teamsByUser").load(env.parentId())
    }
    .dataFetcher("performanceReviews") { env -> env.listLoader("reviewsBySubordinate").load(env.parentId()) }
    .dataFetcher("daysOff") { env ->
        env.yearScopedLoader("daysOffByUser").load(env.parentId() to env.yearArgument("year"))
    }
    .dataFetcher("daysOffCorrections") { env ->
        env.yearScopedLoader("correctionsByUser").load(env.parentId() to env.yearArgument("year"))
    }
    .dataFetcher("daysOffBudget") { env ->
        val loader: DataLoader<Pair<Long, Int>, Map<String, Any?>> = checkNotNull(env.getDataLoader("budgetByUserYear"))
        loader.load(env.parentId() to requireNotNull(env.yearArgument("year")) { "year is non-null in the schema" })
    }
    .dataFetcher("daysOffBudgets") { env ->
        val loader: DataLoader<Pair<Long, Int>, List<Map<String, Any?>>> =
            checkNotNull(env.getDataLoader("budgetsByUserYear"))
        loader.load(env.parentId() to requireNotNull(env.yearArgument("year")) { "year is non-null in the schema" })
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

// parseValue/parseLiteral are currently unreachable — no SDL argument or input uses Long
// (output-only scalar today); kept symmetric and strict as cheap future-proofing (checkup #30).
private object LongCoercing : Coercing<Long, Long> {
    override fun serialize(dataFetcherResult: Any, graphQLContext: GraphQLContext, locale: Locale): Long {
        val number = dataFetcherResult as? Number
            ?: throw CoercingSerializeException("Expected a numeric Long value")
        val long = number.toLong()
        // Refuse silent truncation (a fractional Double on a Long! field is a wiring bug).
        if (number is Double || number is Float) {
            if (number.toDouble() != long.toDouble()) {
                throw CoercingSerializeException("Expected an integral Long value")
            }
        }
        return long
    }

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
    ): Long = when (input) {
        is IntValue -> input.value.toLong()
        is graphql.language.StringValue ->
            input.value?.toLongOrNull() ?: throw CoercingParseLiteralException("Expected a Long literal")
        else -> throw CoercingParseLiteralException("Expected a Long literal")
    }
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
