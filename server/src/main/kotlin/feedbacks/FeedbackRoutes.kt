package ch.nokillswit.feedbacks

import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.canReadFeedbackContent
import ch.nokillswit.authz.isAdmin
import ch.nokillswit.authz.requireFeedbackReadAllowingManager
import ch.nokillswit.authz.requireFeedbackWrite
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalLong
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.notifications.NotificationServiceKey
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

fun Application.configureFeedbackRoutes() {
    val feedbackService = attributes[FeedbackServiceKey]
    val feedbackEventService = attributes[FeedbackEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]

    // Shared handler for the lifecycle-transition action endpoints: provider-only, 404 when
    // missing, 409 (via ConflictException in the service) when the transition isn't allowed,
    // otherwise it applies the change, delivers notifications, and records the audit event.
    suspend fun transitionTo(call: ApplicationCall, feedbackId: UInt, target: FeedbackStatus) {
        val caller = call.caller()
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
                val caller = call.caller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "received") {
                    "received" -> FeedbackListView.RECEIVED
                    "provided" -> FeedbackListView.PROVIDED
                    "team" -> FeedbackListView.TEAM
                    else -> throw BadRequestException("Unknown view: $raw (allowed: received, provided, team)")
                }
                val paging = call.parsePaging(
                    sortable = setOf("id", "requesterName", "subjectName", "providerName", "visibility", "status", "lastModified"),
                )
                val visibilityFilter = params.optionalString("visibility")?.let { raw ->
                    runCatching { FeedbackVisibility.valueOf(raw) }.getOrElse {
                        throw BadRequestException(
                            "Unknown visibility: $raw (allowed: ${FeedbackVisibility.entries.joinToString { it.name }})",
                        )
                    }
                }
                val statusFilter = params.optionalString("status")?.let { raw ->
                    runCatching { FeedbackStatus.valueOf(raw) }.getOrElse {
                        throw BadRequestException(
                            "Unknown status: $raw (allowed: ${FeedbackStatus.entries.joinToString { it.name }})",
                        )
                    }
                }
                val providerIdFilter = params.optionalUInt("providerId")
                val subjectIdFilter = params.optionalUInt("subjectId")
                val lastModifiedGteFilter = params.optionalLong("lastModified[gte]")
                val includeIndirect = params.optionalBoolean("includeIndirect")
                if (includeIndirect != null && view != FeedbackListView.TEAM) {
                    throw BadRequestException("includeIndirect is only supported for view=team")
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
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<Feedbacks> {
                val caller = call.caller()
                val feedback = call.receive<FeedbackCreateRequest>().toFeedback()
                // A caller may only create feedback they are a party to — the provider (they author
                // it) or the requester (they ask for it). Admins may create on behalf of others.
                // Prevents authoring feedback as someone else or forging a request from someone else.
                if (!caller.isAdmin() &&
                    caller.userId != feedback.providerId &&
                    caller.userId != feedback.requesterId
                ) {
                    throw ForbiddenException("You may only create feedback you provide or request")
                }
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
                val caller = call.caller()
                val feedback = feedbackService.read(route.id)
                if (feedback == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Feedback not found")
                    return@get
                }
                requireFeedbackReadAllowingManager(caller, feedback) {
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
                val caller = call.caller()
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
                val caller = call.caller()
                val feedbackId = route.parent.id
                val feedback = feedbackService.read(feedbackId)
                if (feedback == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Feedback not found")
                    return@get
                }
                // Whoever may read the feedback may read its history.
                requireFeedbackReadAllowingManager(caller, feedback) {
                    feedbackService.managesSubject(caller.userId, feedback.subjectId)
                }
                call.respond(
                    HttpStatusCode.OK,
                    FeedbackEventListResponse(feedbackEventService.listForFeedback(feedbackId)),
                )
            }
            delete<Feedbacks.Id> { route ->
                val caller = call.caller()
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
                feedbackService.delete(route.id)
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
