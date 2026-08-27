package ch.nokillswit.integration

import ch.nokillswit.daysoff.DaysOffService
import ch.nokillswit.daysoff.parseDaysOffDate
import ch.nokillswit.infra.paging.DEFAULT_PAGE_SIZE
import ch.nokillswit.infra.paging.MAX_PAGE_SIZE
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.reviews.ReviewPeriodService
import ch.nokillswit.teamkpis.TeamKpiService
import ch.nokillswit.teams.TeamService
import ch.nokillswit.users.CareerPositionService
import ch.nokillswit.users.UserService
import graphql.schema.DataFetcher
import graphql.schema.DataFetchingEnvironment
import io.ktor.server.plugins.BadRequestException
import java.util.concurrent.CompletableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.future.future

/** The graphQLContext key carrying the request's CoroutineScope (set by the route handler). */
internal const val SCOPE_CONTEXT_KEY = "lettuce.scope"

/** The feature services the resolvers read through (decryption stays inside each service). */
class IntegrationServices(
    val users: UserService,
    val careerPositions: CareerPositionService,
    val teams: TeamService,
    val daysOff: DaysOffService,
    val reviews: PerformanceReviewService,
    val reviewPeriods: ReviewPeriodService,
    val teamKpis: TeamKpiService,
)

/**
 * Bridges a suspend resolver body into graphql-java's CompletableFuture world on the request's
 * own CoroutineScope (carried in graphQLContext), so a client disconnect cancels in-flight work.
 */
internal fun <T> suspendFetcher(block: suspend (DataFetchingEnvironment) -> T): DataFetcher<CompletableFuture<T>> =
    DataFetcher { env ->
        val scope = checkNotNull(env.graphQlContext.get<CoroutineScope>(SCOPE_CONTEXT_KEY)) {
            "request CoroutineScope missing from graphQLContext"
        }
        scope.future { block(env) }
    }

/**
 * The paged root fields' page/pageSize args with the REST list semantics (1-based, default 20,
 * max 100); sort is pinned to `id` ascending. Violations throw [BadRequestException], which the
 * sanitizing exception handler passes through as a GraphQL error message.
 */
internal fun DataFetchingEnvironment.pageRequest(): PageRequest {
    val page = getArgument<Int>("page") ?: 1
    val pageSize = getArgument<Int>("pageSize") ?: DEFAULT_PAGE_SIZE
    if (page < 1) throw BadRequestException("page must be >= 1")
    if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        throw BadRequestException("pageSize must be between 1 and $MAX_PAGE_SIZE")
    }
    return PageRequest(page = page, pageSize = pageSize, sort = listOf(SortField("id", descending = false)))
}

/** An Int argument as UInt; a negative value is a clean 400-class error, never a wrap. */
internal fun DataFetchingEnvironment.uintArgument(name: String): UInt? =
    getArgument<Int>(name)?.let {
        if (it < 0) throw BadRequestException("$name must be non-negative")
        it.toUInt()
    }

/** An enum argument (graphql-java hands enum values over as their String names). A value the
 *  Kotlin enum lacks (an SDL-only value added ahead of code) is a clean 400-class error, never
 *  an opaque "Internal error" (checkup #30, A-L3). */
internal inline fun <reified E : Enum<E>> DataFetchingEnvironment.enumArgument(name: String): E? =
    getArgument<String>(name)?.let { raw ->
        enumValues<E>().firstOrNull { it.name == raw }
            ?: throw BadRequestException("$name value $raw is not supported")
    }

/** A calendar-year argument with the REST bound (the DaysOffRoutes 2000..2100 rule) — an
 *  unbounded year overflows the closed-form budget arithmetic (checkup #30, A-M4). */
internal fun DataFetchingEnvironment.yearArgument(name: String): Int? =
    getArgument<Int>(name)?.also {
        if (it !in MIN_YEAR..MAX_YEAR) throw BadRequestException("$name must be between $MIN_YEAR and $MAX_YEAR")
    }

/** A strict ISO YYYY-MM-DD argument — an unvalidated bound would compare lexicographically
 *  against the VARCHAR date columns and silently drop rows (checkup #30, B-H1). */
internal fun DataFetchingEnvironment.isoDateArgument(name: String): String? =
    getArgument<String>(name)?.also { parseDaysOffDate(it, name) }

internal const val MIN_YEAR = 2000
internal const val MAX_YEAR = 2100

/** The REST-mirroring page envelope ({items, page, pageSize, total}). */
internal fun pageEnvelope(items: List<Map<String, Any?>>, paging: PageRequest, total: Long): Map<String, Any?> =
    mapOf("items" to items, "page" to paging.page, "pageSize" to paging.pageSize, "total" to total)
