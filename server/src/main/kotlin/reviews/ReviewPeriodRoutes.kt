package ch.nokillswit.reviews

import ch.nokillswit.audit.audit
import ch.nokillswit.infra.db.orVanished
import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.users.Feature
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.request.receive
import io.ktor.server.resources.delete
import io.ktor.server.resources.get
import io.ktor.server.resources.href
import io.ktor.server.resources.post
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/api/v1/review-periods")
class ReviewPeriodsResource {
    @Serializable
    @Resource("{id}")
    class Id(val parent: ReviewPeriodsResource = ReviewPeriodsResource(), val id: UInt)
}

// The gated caller (V46): the review-period registry counts as the PERFORMANCE_REVIEWS
// feature — uniform for admins, who can always re-enable their own flag.
private fun ApplicationCall.reviewPeriodCaller() =
    caller().also { requireFeatureEnabled(it, Feature.PERFORMANCE_REVIEWS) }

fun Application.configureReviewPeriodRoutes() {
    val periodService = attributes[ReviewPeriodServiceKey]

    routing {
        authenticate {
            // The whole timeline, oldest first — unpaged (the dictionaries shape): the registry
            // is intrinsically small and every picker needs all of it. Any authenticated caller
            // may read it (managers pick a period when creating a review).
            get<ReviewPeriodsResource> {
                call.reviewPeriodCaller()
                call.respond(HttpStatusCode.OK, ReviewPeriodList(periodService.list()))
            }
            post<ReviewPeriodsResource> {
                val caller = call.reviewPeriodCaller()
                requireAdmin(caller)
                val request = call.receive<ReviewPeriodCreateRequest>()
                validateReviewPeriod(request)
                // Adjacency (append-only, gapless) is checked in the service, atomically with
                // the insert — a gap or overlap is 409.
                val id = periodService.create(request)
                call.response.header(HttpHeaders.Location, call.application.href(ReviewPeriodsResource.Id(id = id)))
                audit(
                    "review_period.created",
                    "byUserId" to caller.userId.toLong(),
                    "periodId" to id.toLong(),
                    "startMonth" to request.startMonth,
                    "endMonth" to request.endMonth,
                )
                val created = periodService.read(id)
                    .orVanished("Review period", id)
                call.respond(HttpStatusCode.Created, created)
            }
            delete<ReviewPeriodsResource.Id> { route ->
                val caller = call.reviewPeriodCaller()
                requireAdmin(caller)
                // Latest-only + unreferenced-only are checked in the service (409); a missing
                // row is 404 (hard delete — see ReviewPeriodService).
                if (periodService.delete(route.id) == 0) {
                    throw NotFoundException("Review period not found")
                }
                audit(
                    "review_period.deleted",
                    "byUserId" to caller.userId.toLong(),
                    "periodId" to route.id.toLong(),
                )
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
