package ch.nokillswit.feedbacks

import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.canReadFeedbackContent
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requireFeedbackReadAllowingManager
import ch.nokillswit.authz.requireFeedbackWrite
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalLong
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.users.Feature
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
@Resource("/api/v1/feedbacks")
class Feedbacks {
    // The no-duplicate early check for the SPA create screens (see the GET handler).
    @Serializable
    @Resource("duplicate-check")
    class DuplicateCheck(val parent: Feedbacks = Feedbacks())

    @Serializable
    @Resource("{id}")
    class Id(val parent: Feedbacks = Feedbacks(), val id: UInt) {
        @Serializable
        @Resource("events")
        class Events(val parent: Id)

        // Lifecycle-transition actions (POST, no body). The state machine gates which are valid
        // from the current status (invalid → 409).
        @Serializable @Resource("send") class Send(val parent: Id)

        @Serializable @Resource("withdraw") class Withdraw(val parent: Id)

        @Serializable @Resource("reject") class Reject(val parent: Id)

        @Serializable @Resource("pick-up") class PickUp(val parent: Id)
    }
}

// Turn a structured event descriptor into the persistable audit event (the SPA localizes it).
private fun FeedbackEventDescriptor.toEvent(feedbackId: UInt, userId: UInt) = FeedbackEvent(
    feedbackId = feedbackId,
    userId = userId,
    type = type,
    params = params,
)

// The gated caller (V46): every feedback handler resolves its principal through this, so the
// per-user FEEDBACKS flag is enforced before any other guard or read.
private fun ApplicationCall.feedbackCaller() =
    caller().also { requireFeatureEnabled(it, Feature.FEEDBACKS) }

fun Application.configureFeedbackRoutes() {
    val feedbackService = attributes[FeedbackServiceKey]
    val feedbackEventService = attributes[FeedbackEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]
    val userService = attributes[UserServiceKey]

    // Shared handler for the lifecycle-transition action endpoints: provider-only, 404 when
    // missing, 409 (via ConflictException in the service) when the transition isn't allowed,
    // otherwise it applies the change, delivers notifications, and records the audit event.
    suspend fun transitionTo(call: ApplicationCall, feedbackId: UInt, target: FeedbackStatus) {
        val caller = call.feedbackCaller()
        val existing = feedbackService.read(feedbackId)
        if (existing == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Feedback not found")
            return
        }
        requireFeedbackWrite(caller, existing)
        val toNotify = feedbackService.transition(feedbackId, target)
        if (toNotify == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Feedback not found")
            return
        }
        toNotify.forEach { notificationService.create(it) }
        feedbackUpdateEvent(existing, existing.copy(status = target))?.let { descriptor ->
            feedbackEventService.create(descriptor.toEvent(feedbackId, caller.userId))
        }
        call.respond(HttpStatusCode.NoContent)
    }

    routing {
        authenticate {
            get<Feedbacks> {
                val caller = call.feedbackCaller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "received") {
                    "received" -> FeedbackListView.RECEIVED
                    "provided" -> FeedbackListView.PROVIDED
                    "team" -> FeedbackListView.TEAM
                    "user" -> FeedbackListView.USER
                    "kudos" -> FeedbackListView.KUDOS
                    else -> throw BadRequestException("Unknown view: $raw (allowed: received, provided, team, user, kudos)")
                }
                val paging = call.parsePaging(
                    sortable = setOf("id", "requesterName", "subjectName", "providerName", "visibility", "status", "lastModified"),
                )
                val visibilityFilter = params.optionalEnum<FeedbackVisibility>("visibility")
                val statusFilter = params.optionalEnum<FeedbackStatus>("status")
                val providerIdFilter = params.optionalUInt("providerId")
                val subjectIdFilter = params.optionalUInt("subjectId")
                val lastModifiedGteFilter = params.optionalLong("lastModified[gte]")
                val includeIndirect = params.optionalBoolean("includeIndirect")
                if (includeIndirect != null && view != FeedbackListView.TEAM) {
                    throw BadRequestException("includeIndirect is only supported for view=team")
                }
                // The auditor view (HR-only): view-shape validation like counterpartId on the
                // 1:1 list, then the role gate (every use is audit-logged).
                val userId = params.optionalUInt("userId")
                if (view == FeedbackListView.USER && userId == null) {
                    throw BadRequestException("userId is required for view=user")
                }
                if (view != FeedbackListView.USER && userId != null) {
                    throw BadRequestException("userId is only supported for view=user")
                }
                if (view == FeedbackListView.USER) {
                    requireAuditListAccess(caller, "feedback", userId!!)
                }
                val filter = FeedbackListFilter(
                    requesterName = params.optionalString("requesterName"),
                    subjectName = params.optionalString("subjectName"),
                    providerName = params.optionalString("providerName"),
                    providerId = providerIdFilter,
                    subjectId = subjectIdFilter,
                    visibility = visibilityFilter,
                    status = statusFilter,
                    lastModifiedGte = lastModifiedGteFilter,
                )
                val result = feedbackService.list(
                    view,
                    caller.userId,
                    filter,
                    paging,
                    includeIndirect = includeIndirect == true,
                    targetUserId = userId,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            get<Feedbacks.DuplicateCheck> {
                val caller = call.feedbackCaller()
                val params = call.request.queryParameters
                val subjectId = params.optionalUInt("subjectId")
                    ?: throw BadRequestException("subjectId is required")
                val providerId = params.optionalUInt("providerId")
                    ?: throw BadRequestException("providerId is required")
                val requesterId = params.optionalUInt("requesterId")
                // Same party rule as creation: only someone who could create this feedback may
                // probe for its in-progress duplicate — and a matching DRAFT/REQUESTED row always
                // has the caller as a party, so no private draft's existence can leak.
                if (caller.userId != providerId && caller.userId != requesterId) {
                    throw ForbiddenException("You may only check feedback you would provide or request")
                }
                val duplicate = feedbackService.findOpenDuplicate(subjectId, providerId, requesterId)
                call.respond(
                    HttpStatusCode.OK,
                    DuplicateCheckResponse(existingId = duplicate?.first, existingStatus = duplicate?.second),
                )
            }
            post<Feedbacks> {
                val caller = call.feedbackCaller()
                val feedback = call.receive<FeedbackCreateRequest>().toFeedback()
                // A caller may only create feedback they are a party to — the provider (they author
                // it) or the requester (they ask for it). Nobody creates on behalf of others
                // (ADMIN included): this prevents authoring feedback as someone else or forging a
                // request from someone else.
                if (caller.userId != feedback.providerId && caller.userId != feedback.requesterId) {
                    throw ForbiddenException("You may only create feedback you provide or request")
                }
                // After the authz guard (403 wins over 400): no NEW feedback involving a
                // deactivated party. The caller is one of them and holds a session, so this
                // can only trip on the OTHER parties — including them all is simplest.
                userService.requireNoDeactivatedUsers(
                    setOfNotNull(feedback.providerId, feedback.requesterId, feedback.subjectId),
                )
                val result = requireValidReferences("Referenced user does not exist") {
                    feedbackService.create(feedback)
                }
                val id = result.id
                call.response.header(HttpHeaders.Location, call.application.href(Feedbacks.Id(id = id)))
                // Best-effort side effect: deliver creation notifications after the commit.
                result.notifications.forEach { notificationService.create(it) }
                // Re-read so the response carries the server-assigned lastModified.
                val created = feedbackService.read(id) ?: feedback
                // Audit: record the creation against the acting caller.
                feedbackEventService.create(feedbackCreationEvent(created).toEvent(id, caller.userId))
                val names = feedbackService.partyNames(created)
                call.respond(HttpStatusCode.Created, created.toResponse(id, names))
            }
            get<Feedbacks.Id> { route ->
                val caller = call.feedbackCaller()
                val feedback = feedbackService.read(route.id)
                if (feedback == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Feedback not found")
                    return@get
                }
                requireFeedbackReadAllowingManager(caller, feedback, route.id) {
                    feedbackService.managesSubject(caller.userId, feedback.subjectId)
                }
                val names = feedbackService.partyNames(feedback)
                call.respond(
                    HttpStatusCode.OK,
                    feedback.toResponse(
                        route.id,
                        names,
                        includeContent = canReadFeedbackContent(caller, feedback),
                    ),
                )
            }
            put<Feedbacks.Id> { route ->
                val caller = call.feedbackCaller()
                val existing = feedbackService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Feedback not found")
                    return@put
                }
                requireFeedbackWrite(caller, existing)
                val edit = call.receive<FeedbackContentUpdate>()
                val updated = feedbackService.editContent(route.id, edit.content, edit.visibility)
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Feedback not found")
                    return@put
                }
                // Audit: record a content/visibility edit against the caller (no status change here).
                feedbackUpdateEvent(
                    existing,
                    existing.copy(content = edit.content, visibility = edit.visibility),
                )?.let { descriptor ->
                    feedbackEventService.create(descriptor.toEvent(route.id, caller.userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            post<Feedbacks.Id.Send> { route -> transitionTo(call, route.parent.id, FeedbackStatus.SENT) }
            post<Feedbacks.Id.Withdraw> { route ->
                transitionTo(call, route.parent.id, FeedbackStatus.WITHDRAWN)
            }
            post<Feedbacks.Id.Reject> { route -> transitionTo(call, route.parent.id, FeedbackStatus.REJECTED) }
            post<Feedbacks.Id.PickUp> { route -> transitionTo(call, route.parent.id, FeedbackStatus.DRAFT) }
            get<Feedbacks.Id.Events> { route ->
                val caller = call.feedbackCaller()
                val feedbackId = route.parent.id
                val feedback = feedbackService.read(feedbackId)
                if (feedback == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Feedback not found")
                    return@get
                }
                // Whoever may read the feedback may read its history.
                requireFeedbackReadAllowingManager(caller, feedback, feedbackId) {
                    feedbackService.managesSubject(caller.userId, feedback.subjectId)
                }
                call.respond(
                    HttpStatusCode.OK,
                    FeedbackEventListResponse(feedbackEventService.listForFeedback(feedbackId)),
                )
            }
            delete<Feedbacks.Id> { route ->
                val caller = call.feedbackCaller()
                val existing = feedbackService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Feedback not found")
                    return@delete
                }
                requireFeedbackWrite(caller, existing)
                // Delete is a draft-only action; other statuses have terminal transitions instead.
                if (existing.status != FeedbackStatus.DRAFT) {
                    throw BadRequestException("Only a draft feedback may be deleted")
                }
                if (feedbackService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Feedback not found")
                    return@delete
                }
                // Audit the deletion against the acting provider (events outlive the soft-deleted row).
                feedbackEventService.create(feedbackDeletionEvent().toEvent(route.id, caller.userId))
                // Best-effort side effect: tell the requester (if any) the provider deleted it (no link).
                val names = feedbackService.partyNames(existing)
                feedbackDeletionNotifications(existing, names).forEach { notificationService.create(it) }
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
