package ch.nokillswit.reviews

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.plugins.respondProblem
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

fun Application.configureReviewPeriodRoutes() {
    val periodService = attributes[ReviewPeriodServiceKey]

    routing {
        authenticate {
            // The whole timeline, oldest first — unpaged (the dictionaries shape): the registry
            // is intrinsically small and every picker needs all of it. Any authenticated caller
            // may read it (managers pick a period when creating a review).
            get<ReviewPeriodsResource> {
                call.caller()
                call.respond(HttpStatusCode.OK, ReviewPeriodList(periodService.list()))
            }
            post<ReviewPeriodsResource> {
                val caller = call.caller()
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
                    ?: error("Review period $id vanished between create and re-read")
                call.respond(HttpStatusCode.Created, created)
            }
            delete<ReviewPeriodsResource.Id> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                // Latest-only + unreferenced-only are checked in the service (409); a missing
                // row is 404 (hard delete — see ReviewPeriodService).
                if (periodService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Review period not found")
                    return@delete
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
