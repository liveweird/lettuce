package ch.nokillswit.reviews

import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requireRelationship
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.authz.requirePerformanceReviewReadAllowingManager
import ch.nokillswit.authz.requirePerformanceReviewWrite
import ch.nokillswit.infra.db.orVanished
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalIncludeIndirect
import ch.nokillswit.infra.paging.optionalLong
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.infra.paging.uintOnlyForView
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserServiceKey
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

// The gated caller (V46): every review handler resolves its principal through this, so the
// per-user PERFORMANCE_REVIEWS flag is enforced before any other guard or read.
private fun ApplicationCall.reviewCaller() =
    caller().also { requireFeatureEnabled(it, Feature.PERFORMANCE_REVIEWS) }

fun Application.configurePerformanceReviewRoutes() {
    val reviewService = attributes[PerformanceReviewServiceKey]
    val reviewEventService = attributes[PerformanceReviewEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]
    val userService = attributes[UserServiceKey]

    // The uniform read preamble (the 404-before-403 idiom): resolves the review (missing →
    // NotFoundException) and enforces the document read rule (manager / audited HR at any
    // status; the subordinate once PUBLISHED; chain managers once out of DRAFT — the guard
    // itself throws ForbiddenException). Shared by the document and events GETs.
    suspend fun readGuardedReview(call: ApplicationCall, reviewId: UInt): PerformanceReviewResponse {
        val caller = call.reviewCaller()
        val review = reviewService.read(reviewId)
            ?: throw NotFoundException("Performance review not found")
        requirePerformanceReviewReadAllowingManager(caller, review) {
            reviewService.managesSubordinate(caller.userId, review.subordinateId)
        }
        return review
    }

    // The write sibling: manager-only (nobody else — ADMIN included). Guards run BEFORE any
    // body is received, so an outsider's malformed payload is still 403.
    suspend fun writeGuardedReview(call: ApplicationCall, reviewId: UInt): PerformanceReviewResponse {
        // The gated caller resolves FIRST: a PERFORMANCE_REVIEWS-disabled caller gets a uniform
        // 403 before the read (the feature 403 must precede the 404).
        val caller = call.reviewCaller()
        val review = reviewService.read(reviewId)
            ?: throw NotFoundException("Performance review not found")
        requirePerformanceReviewWrite(caller, review)
        return review
    }

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
        val existing = writeGuardedReview(call, reviewId)
        // Submission only: an incomplete review may not enter calibration — all four ratings
        // and summaries must be filled (the goals stale-due-date activate idiom: a route-side
        // 400 against the pre-read).
        if (from == PerformanceReviewStatus.DRAFT && target == PerformanceReviewStatus.CALIBRATION) {
            requireCompleteAssessments(assessmentsOf(existing))
        }
        val toNotify = reviewService.transition(reviewId, from, target)
            ?: throw NotFoundException("Performance review not found")
        toNotify.forEach { notificationService.create(it) }
        reviewEventService.create(reviewTransitionEvent(from, target).toEvent(reviewId, call.caller().userId))
        call.respond(HttpStatusCode.NoContent)
    }

    routing {
        authenticate {
            get<PerformanceReviews> {
                val caller = call.reviewCaller()
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
                val includeIndirect = params.optionalIncludeIndirect(
                    view,
                    listOf(PerformanceReviewListView.MANAGED, PerformanceReviewListView.TEAM),
                )
                // The auditor view (HR-only): view-shape validation first, then the role gate
                // (every use is audit-logged) — the goals-list idiom.
                val userId = params.uintOnlyForView("userId", view, PerformanceReviewListView.USER)
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
                    includeIndirect = includeIndirect,
                    targetUserId = userId,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<PerformanceReviews> {
                val caller = call.reviewCaller()
                val request = call.receive<PerformanceReviewCreateRequest>()
                // The manager is always the caller (no create-on-behalf, not even for ADMIN) and
                // the subordinate must be in the caller's TRANSITIVE chain right now (the chain
                // rule, v2.33.0; one review per (subordinate, period) makes it first-writer-wins
                // — a second chain manager hits the 409). Checked before payload validation so
                // an outsider's malformed request is still 403, not 400.
                requireRelationship(
                    caller,
                    { reviewService.managesSubordinate(caller.userId, request.subordinateId) },
                    "You may only review reports in your management chain",
                )
                // After the authz guard (403 wins over 400): no NEW reviews for deactivated users.
                userService.requireNoDeactivatedUsers(listOf(request.subordinateId))
                val id = requireValidReferences("Referenced user or period does not exist") {
                    reviewService.create(caller.userId, request)
                }
                call.response.header(HttpHeaders.Location, call.application.href(PerformanceReviews.Id(id = id)))
                // Audit: record the creation against the acting manager. No notification — the
                // review is a private draft until published.
                reviewEventService.create(reviewCreationEvent().toEvent(id, caller.userId))
                val created = reviewService.read(id)
                    .orVanished("Performance review", id)
                call.respond(HttpStatusCode.Created, created)
            }
            get<PerformanceReviews.Id> { route ->
                val review = readGuardedReview(call, route.id)
                call.respond(HttpStatusCode.OK, review)
            }
            put<PerformanceReviews.Id> { route ->
                val existing = writeGuardedReview(call, route.id)
                val edit = call.receive<PerformanceReviewUpdateRequest>()
                // Field validation, the PUBLISHED read-only rule (409), and the CALIBRATION
                // completeness rule all happen in the service, atomically with the update.
                val updated = reviewService.update(route.id, edit)
                if (updated == 0) {
                    throw NotFoundException("Performance review not found")
                }
                // Audit: one event per changed aspect; a no-op PUT records nothing.
                reviewUpdateEvents(existing, edit).forEach { descriptor ->
                    reviewEventService.create(descriptor.toEvent(route.id, call.caller().userId))
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
                val reviewId = route.parent.id
                // Whoever may read the review may read its history.
                readGuardedReview(call, reviewId)
                call.respond(
                    HttpStatusCode.OK,
                    PerformanceReviewEventListResponse(reviewEventService.listForReview(reviewId)),
                )
            }
            delete<PerformanceReviews.Id> { route ->
                val existing = writeGuardedReview(call, route.id)
                // Delete is a draft-only action (it also frees the (subordinate, period) slot);
                // reviews past DRAFT move through the transitions instead, keeping the record.
                if (existing.status != PerformanceReviewStatus.DRAFT) {
                    throw BadRequestException("Only a draft performance review may be deleted")
                }
                if (reviewService.delete(route.id) == 0) {
                    throw NotFoundException("Performance review not found")
                }
                // Audit the deletion against the acting manager (events outlive the soft-deleted
                // row). No notification — deleting a private draft is invisible activity.
                reviewEventService.create(reviewDeletionEvent().toEvent(route.id, call.caller().userId))
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
