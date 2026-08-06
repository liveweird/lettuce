package ch.nokillswit.reviews

import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requirePerformanceReviewReadAllowingManager
import ch.nokillswit.authz.requirePerformanceReviewWrite
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalLong
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.users.UserServiceKey
import ch.nokillswit.plugins.respondProblem
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.request.receive
import io.ktor.server.resources.delete
import io.ktor.server.resources.get
import io.ktor.server.resources.href
import io.ktor.server.resources.post
import io.ktor.server.resources.put
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/api/v1/performance-reviews")
class PerformanceReviews {
    @Serializable
    @Resource("{id}")
    class Id(val parent: PerformanceReviews = PerformanceReviews(), val id: UInt) {
        @Serializable
        @Resource("events")
        class Events(val parent: Id)

        // Lifecycle-transition actions (POST), all bodyless. The state machine gates which are
        // valid from the current status (invalid → 409); each endpoint names its whole edge —
        // submit and unpublish share the CALIBRATION target and would otherwise be
        // interchangeable.
        @Serializable @Resource("submit") class Submit(val parent: Id)

        @Serializable @Resource("revert") class Revert(val parent: Id)

        @Serializable @Resource("publish") class Publish(val parent: Id)

        @Serializable @Resource("unpublish") class Unpublish(val parent: Id)
    }
}

// Turn a structured event descriptor into the persistable audit event (the SPA localizes it).
private fun PerformanceReviewEventDescriptor.toEvent(reviewId: UInt, userId: UInt) =
    PerformanceReviewEvent(
        reviewId = reviewId,
        userId = userId,
        type = type,
        params = params,
    )

fun Application.configurePerformanceReviewRoutes() {
    val reviewService = attributes[PerformanceReviewServiceKey]
    val reviewEventService = attributes[PerformanceReviewEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]
    val userService = attributes[UserServiceKey]

    // Shared handler for the lifecycle-transition action endpoints: manager-only, 404 when
    // missing, 409 (via ConflictException in the service) when the review is not at the edge's
    // source status, otherwise it applies the change, delivers the subordinate's notification
    // (publish/unpublish only — draft <-> calibration is invisible to them), and records the
    // audit event. Each endpoint names its whole edge (from AND target) — see
    // PerformanceReviewService.transition.
    suspend fun transitionTo(
        call: ApplicationCall,
        reviewId: UInt,
        from: PerformanceReviewStatus,
        target: PerformanceReviewStatus,
    ) {
        val caller = call.caller()
        val existing = reviewService.read(reviewId)
        if (existing == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Performance review not found")
            return
        }
        requirePerformanceReviewWrite(caller, existing)
        // Submission only: an incomplete review may not enter calibration — all four ratings
        // and summaries must be filled (the goals stale-due-date activate idiom: a route-side
        // 400 against the pre-read).
        if (from == PerformanceReviewStatus.DRAFT && target == PerformanceReviewStatus.CALIBRATION) {
            requireCompleteAssessments(assessmentsOf(existing))
        }
        val toNotify = reviewService.transition(reviewId, from, target)
        if (toNotify == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Performance review not found")
            return
        }
        toNotify.forEach { notificationService.create(it) }
        reviewEventService.create(reviewTransitionEvent(from, target).toEvent(reviewId, caller.userId))
        call.respond(HttpStatusCode.NoContent)
    }

    routing {
        authenticate {
            get<PerformanceReviews> {
                val caller = call.caller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "own") {
                    "own" -> PerformanceReviewListView.OWN
                    "managed" -> PerformanceReviewListView.MANAGED
                    "team" -> PerformanceReviewListView.TEAM
                    "user" -> PerformanceReviewListView.USER
                    else -> throw BadRequestException("Unknown view: $raw (allowed: own, managed, team, user)")
                }
                val paging = call.parsePaging(
                    sortable = setOf(
                        "id", "managerName", "subordinateName", "periodStart", "status",
                        "createdAt", "lastModified",
                    ),
                    defaultSort = listOf(SortField("createdAt", descending = true)),
                )
                val includeIndirect = params.optionalBoolean("includeIndirect")
                if (includeIndirect != null &&
                    view != PerformanceReviewListView.MANAGED &&
                    view != PerformanceReviewListView.TEAM
                ) {
                    throw BadRequestException("includeIndirect is only supported for view=managed and view=team")
                }
                // The auditor view (HR-only): view-shape validation first, then the role gate
                // (every use is audit-logged) — the goals-list idiom.
                val userId = params.optionalUInt("userId")
                if (view == PerformanceReviewListView.USER && userId == null) {
                    throw BadRequestException("userId is required for view=user")
                }
                if (view != PerformanceReviewListView.USER && userId != null) {
                    throw BadRequestException("userId is only supported for view=user")
                }
                if (view == PerformanceReviewListView.USER) {
                    requireAuditListAccess(caller, "performanceReview", userId!!)
                }
                val filter = PerformanceReviewListFilter(
                    managerName = params.optionalString("managerName"),
                    subordinateName = params.optionalString("subordinateName"),
                    managerId = params.optionalUInt("managerId"),
                    subordinateId = params.optionalUInt("subordinateId"),
                    periodId = params.optionalUInt("periodId"),
                    status = params.optionalEnum<PerformanceReviewStatus>("status"),
                    createdAtGte = params.optionalLong("createdAt[gte]"),
                    lastModifiedGte = params.optionalLong("lastModified[gte]"),
                )
                val result = reviewService.list(
                    view,
                    caller.userId,
                    filter,
                    paging,
                    includeIndirect = includeIndirect == true,
                    targetUserId = userId,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<PerformanceReviews> {
                val caller = call.caller()
                val request = call.receive<PerformanceReviewCreateRequest>()
                // The manager is always the caller (no create-on-behalf, not even for ADMIN) and
                // the subordinate must be a direct report right now. Checked before payload
                // validation so an outsider's malformed request is still 403, not 400.
                if (!reviewService.isDirectReport(caller.userId, request.subordinateId)) {
                    throw ForbiddenException("You may only review your direct reports")
                }
                // After the authz guard (403 wins over 400): no NEW reviews for deactivated users.
                userService.requireNoDeactivatedUsers(listOf(request.subordinateId))
                val id = requireValidReferences("Referenced user or period does not exist") {
                    reviewService.create(caller.userId, request)
                }
                call.response.header(HttpHeaders.Location, call.application.href(PerformanceReviews.Id(id = id)))
                // Audit: record the creation against the acting manager. No notification — the
                // review is a private draft until published.
                reviewEventService.create(reviewCreationEvent().toEvent(id, caller.userId))
                // The create committed (Location set, CREATED event persisted), so a missing
                // re-read is a server-side anomaly, not a client 404.
                val created = reviewService.read(id)
                    ?: error("Performance review $id vanished between create and re-read")
                call.respond(HttpStatusCode.Created, created)
            }
            get<PerformanceReviews.Id> { route ->
                val caller = call.caller()
                val review = reviewService.read(route.id)
                if (review == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Performance review not found")
                    return@get
                }
                requirePerformanceReviewReadAllowingManager(caller, review) {
                    reviewService.managesSubordinate(caller.userId, review.subordinateId)
                }
                call.respond(HttpStatusCode.OK, review)
            }
            put<PerformanceReviews.Id> { route ->
                val caller = call.caller()
                val existing = reviewService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Performance review not found")
                    return@put
                }
                requirePerformanceReviewWrite(caller, existing)
                val edit = call.receive<PerformanceReviewUpdateRequest>()
                // Field validation, the PUBLISHED read-only rule (409), and the CALIBRATION
                // completeness rule all happen in the service, atomically with the update.
                val updated = reviewService.update(route.id, edit)
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Performance review not found")
                    return@put
                }
                // Audit: one event per changed aspect; a no-op PUT records nothing.
                reviewUpdateEvents(existing, edit).forEach { descriptor ->
                    reviewEventService.create(descriptor.toEvent(route.id, caller.userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            post<PerformanceReviews.Id.Submit> { route ->
                transitionTo(
                    call, route.parent.id,
                    from = PerformanceReviewStatus.DRAFT, target = PerformanceReviewStatus.CALIBRATION,
                )
            }
            post<PerformanceReviews.Id.Revert> { route ->
                transitionTo(
                    call, route.parent.id,
                    from = PerformanceReviewStatus.CALIBRATION, target = PerformanceReviewStatus.DRAFT,
                )
            }
            post<PerformanceReviews.Id.Publish> { route ->
                transitionTo(
                    call, route.parent.id,
                    from = PerformanceReviewStatus.CALIBRATION, target = PerformanceReviewStatus.PUBLISHED,
                )
            }
            post<PerformanceReviews.Id.Unpublish> { route ->
                transitionTo(
                    call, route.parent.id,
                    from = PerformanceReviewStatus.PUBLISHED, target = PerformanceReviewStatus.CALIBRATION,
                )
            }
            get<PerformanceReviews.Id.Events> { route ->
                val caller = call.caller()
                val reviewId = route.parent.id
                val review = reviewService.read(reviewId)
                if (review == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Performance review not found")
                    return@get
                }
                // Whoever may read the review may read its history.
                requirePerformanceReviewReadAllowingManager(caller, review) {
                    reviewService.managesSubordinate(caller.userId, review.subordinateId)
                }
                call.respond(
                    HttpStatusCode.OK,
                    PerformanceReviewEventListResponse(reviewEventService.listForReview(reviewId)),
                )
            }
            delete<PerformanceReviews.Id> { route ->
                val caller = call.caller()
                val existing = reviewService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Performance review not found")
                    return@delete
                }
                requirePerformanceReviewWrite(caller, existing)
                // Delete is a draft-only action (it also frees the (subordinate, period) slot);
                // reviews past DRAFT move through the transitions instead, keeping the record.
                if (existing.status != PerformanceReviewStatus.DRAFT) {
                    throw BadRequestException("Only a draft performance review may be deleted")
                }
                if (reviewService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Performance review not found")
                    return@delete
                }
                // Audit the deletion against the acting manager (events outlive the soft-deleted
                // row). No notification — deleting a private draft is invisible activity.
                reviewEventService.create(reviewDeletionEvent().toEvent(route.id, caller.userId))
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
