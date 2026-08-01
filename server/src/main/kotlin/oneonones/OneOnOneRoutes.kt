package ch.nokillswit.oneonones

import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requireOneOnOneReadAllowingManager
import ch.nokillswit.authz.requireOneOnOneWrite
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.parsePaging
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
import java.time.LocalDate
import java.time.format.DateTimeParseException
import kotlinx.serialization.Serializable

@Serializable
@Resource("/api/v1/one-on-ones")
class OneOnOnes {
    @Serializable
    @Resource("{id}")
    class Id(val parent: OneOnOnes = OneOnOnes(), val id: UInt) {
        @Serializable
        @Resource("events")
        class Events(val parent: Id)
    }

    @Serializable
    @Resource("action-items")
    class ActionItems(val parent: OneOnOnes = OneOnOnes()) {
        @Serializable
        @Resource("{id}")
        class Id(val parent: ActionItems = ActionItems(), val id: UInt) {
            @Serializable
            @Resource("history")
            class History(val parent: Id)
        }
    }
}

internal const val MAX_ONE_ON_ONE_ITEM_LENGTH = 4000
internal const val MAX_ONE_ON_ONE_ITEMS_PER_LIST = 100

// Turn a structured event descriptor into the persistable audit event (the SPA localizes it).
private fun OneOnOneEventDescriptor.toEvent(meetingId: UInt, userId: UInt) = OneOnOneEvent(
    meetingId = meetingId,
    userId = userId,
    type = type,
    params = params,
)

/** 400 unless [value] is a zero-padded ISO date — anything else would sort wrong as VARCHAR. */
private fun requireIsoDate(value: String, field: String) {
    val valid = value.length == 10 && try {
        LocalDate.parse(value)
        true
    } catch (_: DateTimeParseException) {
        false
    }
    if (!valid) throw BadRequestException("$field must be an ISO date (YYYY-MM-DD)")
}

/**
 * Feature-local payload validation (invoked AFTER the authz guard — 403 wins over 400):
 * dates are strict ISO, paragraphs non-blank and bounded, list sizes capped, and create
 * payloads must not carry item ids (ids only identify existing rows on PUT).
 */
private fun validateOneOnOnePayload(
    meetingDate: String,
    points: List<OneOnOneItemInput>,
    decisions: List<OneOnOneItemInput>,
    actionItems: List<OneOnOneActionItemInput>,
    forbidIds: Boolean = false,
) {
    requireIsoDate(meetingDate, "meetingDate")
    fun validateContent(content: String, list: String) {
        if (content.isBlank()) throw BadRequestException("$list entries must not be blank")
        if (content.length > MAX_ONE_ON_ONE_ITEM_LENGTH) {
            throw BadRequestException("$list entries must be at most $MAX_ONE_ON_ONE_ITEM_LENGTH characters")
        }
    }
    fun validateSize(size: Int, list: String) {
        if (size > MAX_ONE_ON_ONE_ITEMS_PER_LIST) {
            throw BadRequestException("$list must have at most $MAX_ONE_ON_ONE_ITEMS_PER_LIST entries")
        }
    }
    validateSize(points.size, "points")
    validateSize(decisions.size, "decisions")
    validateSize(actionItems.size, "actionItems")
    points.forEach { validateContent(it.content, "points") }
    decisions.forEach { validateContent(it.content, "decisions") }
    actionItems.forEach { item ->
        validateContent(item.content, "actionItems")
        item.dueDate?.let { requireIsoDate(it, "dueDate") }
    }
    if (forbidIds &&
        (points.any { it.id != null } || decisions.any { it.id != null } || actionItems.any { it.id != null })
    ) {
        throw BadRequestException("Items must not carry ids on creation")
    }
}

fun Application.configureOneOnOneRoutes() {
    val oneOnOneService = attributes[OneOnOneServiceKey]
    val oneOnOneEventService = attributes[OneOnOneEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]

    routing {
        authenticate {
            get<OneOnOnes> {
                val caller = call.caller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "own") {
                    "own" -> OneOnOneListView.OWN
                    "managed" -> OneOnOneListView.MANAGED
                    "team" -> OneOnOneListView.TEAM
                    "with" -> OneOnOneListView.WITH
                    "user" -> OneOnOneListView.USER
                    else -> throw BadRequestException("Unknown view: $raw (allowed: own, managed, team, with, user)")
                }
                val paging = call.parsePaging(
                    sortable = setOf("id", "meetingDate", "managerName", "subordinateName", "lastModified"),
                    defaultSort = listOf(SortField("meetingDate", descending = true)),
                )
                val meetingDateGte = params.optionalString("meetingDate[gte]")?.also { requireIsoDate(it, "meetingDate[gte]") }
                val meetingDateLte = params.optionalString("meetingDate[lte]")?.also { requireIsoDate(it, "meetingDate[lte]") }
                val includeIndirect = params.optionalBoolean("includeIndirect")
                if (includeIndirect != null && view != OneOnOneListView.TEAM) {
                    throw BadRequestException("includeIndirect is only supported for view=team")
                }
                val counterpartId = params.optionalUInt("counterpartId")
                if (view == OneOnOneListView.WITH && counterpartId == null) {
                    throw BadRequestException("counterpartId is required for view=with")
                }
                if (view != OneOnOneListView.WITH && counterpartId != null) {
                    throw BadRequestException("counterpartId is only supported for view=with")
                }
                // The auditor view (HR-only): view-shape validation like counterpartId above,
                // then the role gate (every use is audit-logged).
                val userId = params.optionalUInt("userId")
                if (view == OneOnOneListView.USER && userId == null) {
                    throw BadRequestException("userId is required for view=user")
                }
                if (view != OneOnOneListView.USER && userId != null) {
                    throw BadRequestException("userId is only supported for view=user")
                }
                if (view == OneOnOneListView.USER) {
                    requireAuditListAccess(caller, "oneOnOne", userId!!)
                }
                val filter = OneOnOneListFilter(
                    managerName = params.optionalString("managerName"),
                    subordinateName = params.optionalString("subordinateName"),
                    meetingDateGte = meetingDateGte,
                    meetingDateLte = meetingDateLte,
                )
                val result = oneOnOneService.list(
                    view,
                    caller.userId,
                    filter,
                    paging,
                    includeIndirect = includeIndirect == true,
                    counterpartId = counterpartId,
                    targetUserId = userId,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<OneOnOnes> {
                val caller = call.caller()
                val request = call.receive<OneOnOneCreateRequest>()
                // The manager is ALWAYS the author: the caller documents their own 1:1, so there
                // is no ADMIN create-on-behalf. The subordinate must be a current direct report
                // (a member of a team the caller manages) — this is the relationship the feature
                // models; the read right for higher chain managers comes later, not at creation.
                if (!oneOnOneService.isDirectReport(caller.userId, request.subordinateId)) {
                    throw ForbiddenException("You may only document 1:1 meetings with your direct reports")
                }
                validateOneOnOnePayload(
                    request.meetingDate, request.points, request.decisions, request.actionItems,
                    forbidIds = true,
                )
                val result = requireValidReferences("Referenced user does not exist") {
                    oneOnOneService.create(caller.userId, request)
                }
                call.response.header(HttpHeaders.Location, call.application.href(OneOnOnes.Id(id = result.id)))
                // Best-effort side effect: deliver the subordinate's notification after the commit.
                result.notifications.forEach { notificationService.create(it) }
                // Audit: record the creation (with the carry-over count) against the acting manager.
                oneOnOneEventService.create(
                    oneOnOneCreationEvent(request.meetingDate, result.carriedOver).toEvent(result.id, caller.userId),
                )
                // The create committed (Location header, notification and CREATED event are already
                // persisted), so a missing re-read is a server-side anomaly, not a client 404.
                val created = oneOnOneService.read(result.id)
                    ?: error("1:1 meeting ${result.id} vanished between create and re-read")
                call.respond(HttpStatusCode.Created, created)
            }
            get<OneOnOnes.Id> { route ->
                val caller = call.caller()
                val meeting = oneOnOneService.read(route.id)
                if (meeting == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "1:1 meeting not found")
                    return@get
                }
                requireOneOnOneReadAllowingManager(caller, meeting) {
                    oneOnOneService.managesSubordinate(caller.userId, meeting.subordinateId)
                }
                call.respond(HttpStatusCode.OK, meeting)
            }
            put<OneOnOnes.Id> { route ->
                val caller = call.caller()
                val existing = oneOnOneService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "1:1 meeting not found")
                    return@put
                }
                requireOneOnOneWrite(caller, existing)
                val request = call.receive<OneOnOneUpdateRequest>()
                validateOneOnOnePayload(
                    request.meetingDate, request.points, request.decisions, request.actionItems,
                )
                // The latest-only + chronological write rules live in the service so they validate
                // atomically with the mutation (409 via ConflictException, mapped by StatusPages).
                val updated = oneOnOneService.replace(route.id, request)
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "1:1 meeting not found")
                    return@put
                }
                // Audit: one structured event per changed aspect, diffed against the pre-replace
                // document (added items need no ids in params, so the request suffices).
                oneOnOneUpdateEvents(existing, request).forEach { descriptor ->
                    oneOnOneEventService.create(descriptor.toEvent(route.id, caller.userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<OneOnOnes.Id> { route ->
                val caller = call.caller()
                val existing = oneOnOneService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "1:1 meeting not found")
                    return@delete
                }
                requireOneOnOneWrite(caller, existing)
                // Latest-only rule (deleting an old meeting would rewrite history) is enforced in the
                // service, atomically with the soft-delete — 409 via ConflictException.
                if (oneOnOneService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "1:1 meeting not found")
                    return@delete
                }
                // Audit the deletion against the acting manager (events outlive the soft-deleted
                // row). No notification — creation is the only notifying event for 1:1s.
                oneOnOneEventService.create(oneOnOneDeletionEvent().toEvent(route.id, caller.userId))
                call.respond(HttpStatusCode.NoContent)
            }
            get<OneOnOnes.Id.Events> { route ->
                val caller = call.caller()
                val meetingId = route.parent.id
                val meeting = oneOnOneService.read(meetingId)
                if (meeting == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "1:1 meeting not found")
                    return@get
                }
                // Whoever may read the meeting may read its history.
                requireOneOnOneReadAllowingManager(caller, meeting) {
                    oneOnOneService.managesSubordinate(caller.userId, meeting.subordinateId)
                }
                call.respond(
                    HttpStatusCode.OK,
                    OneOnOneEventListResponse(oneOnOneEventService.listForMeeting(meetingId)),
                )
            }
            get<OneOnOnes.ActionItems.Id.History> { route ->
                val caller = call.caller()
                val result = oneOnOneService.actionItemHistory(route.parent.id)
                if (result == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Action item not found")
                    return@get
                }
                // One check covers the whole chain: every copy belongs to a meeting of the same
                // manager+subordinate pair, so the queried item's meeting is the authz anchor.
                val meeting = oneOnOneService.read(result.meetingId)
                if (meeting == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Action item not found")
                    return@get
                }
                requireOneOnOneReadAllowingManager(caller, meeting) {
                    oneOnOneService.managesSubordinate(caller.userId, meeting.subordinateId)
                }
                call.respond(HttpStatusCode.OK, ActionItemHistoryResponse(result.entries))
            }
        }
    }
}
