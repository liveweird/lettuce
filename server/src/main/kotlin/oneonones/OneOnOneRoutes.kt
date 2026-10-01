package ch.nokillswit.oneonones

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.isHr
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requireRelationship
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.authz.requireOneOnOneWrite
import ch.nokillswit.infra.db.orVanished
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalIncludeIndirect
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.infra.paging.uintOnlyForView
import ch.nokillswit.infra.parseIsoDateStrict
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.sharing.ReadVia
import ch.nokillswit.sharing.ShareAccessKey
import ch.nokillswit.sharing.ShareableResourceType
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
    parseIsoDateStrict(value, field)
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

/** A meeting the caller may read, and how (own right or through a share). */
private class GuardedMeeting(val meeting: OneOnOneResponse, val via: ReadVia<Unit>)

// The gated caller (V46): every 1:1 handler resolves its principal through this, so the
// per-user ONE_ON_ONES flag is enforced before any other guard or read.
private fun ApplicationCall.oneOnOneCaller() =
    caller().also { requireFeatureEnabled(it, Feature.ONE_ON_ONES) }

fun Application.configureOneOnOneRoutes() {
    val oneOnOneService = attributes[OneOnOneServiceKey]
    val oneOnOneEventService = attributes[OneOnOneEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]
    val userService = attributes[UserServiceKey]
    val shareAccess = attributes[ShareAccessKey]

    // The uniform read preamble (the 404-before-403 idiom): resolves the meeting (missing →
    // NotFoundException) and enforces the document read rule (parties / audited HR / chain
    // managers — the guard itself throws ForbiddenException), OR — since v4.8.0 — an active SHARE
    // of it (`ShareAccess.readOrShared`: the same guard, re-run for the sharer with the HR role
    // stripped). 1:1s have no per-reader content gate (every reader sees the same notes,
    // decisions and action items), so no `sufficient` check is needed. Shared by the document and
    // events GETs; the action-item history keys its 404s on the ITEM, stays inline, and stays
    // OWN-RIGHT ONLY (see there).
    suspend fun readGuardedMeeting(call: ApplicationCall, meetingId: UInt): GuardedMeeting {
        val caller = call.oneOnOneCaller()
        val meeting = oneOnOneService.read(meetingId)
            ?: throw NotFoundException("1:1 meeting not found")
        val via = shareAccess.readOrShared(caller, ShareableResourceType.ONE_ON_ONE, meetingId) {
            oneOnOneService.requireReadable(it, meeting)
        }
        return GuardedMeeting(meeting, via)
    }

    // `canShare` (the share button's gate): the caller reads this meeting in their OWN right — no
    // share involved, and never via the HR role alone (the guard is re-run role-stripped, which
    // only matters for an HR caller). No guard re-run when the read already tells.
    suspend fun canShare(caller: CallerPrincipal, via: ReadVia<Unit>, meeting: OneOnOneResponse): Boolean = when {
        via is ReadVia.Shared && via.ownDenied -> false
        !caller.isHr() -> true
        else -> shareAccess.holdsOwnRight(caller, ShareableResourceType.ONE_ON_ONE) {
            oneOnOneService.requireReadable(it, meeting)
        }
    }

    // The write sibling: manager-only (nobody else — ADMIN included). Guards run BEFORE any
    // body is received, so an outsider's malformed payload is still 403.
    suspend fun writeGuardedMeeting(call: ApplicationCall, meetingId: UInt): OneOnOneResponse {
        // The gated caller resolves FIRST: a ONE_ON_ONES-disabled caller gets a uniform 403
        // before the read (the feature 403 must precede the 404).
        val caller = call.oneOnOneCaller()
        val meeting = oneOnOneService.read(meetingId)
            ?: throw NotFoundException("1:1 meeting not found")
        requireOneOnOneWrite(caller, meeting)
        return meeting
    }

    routing {
        authenticate {
            get<OneOnOnes> {
                val caller = call.oneOnOneCaller()
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
                val latestOnly = params.optionalBoolean("latestOnly") == true
                val includeIndirect = params.optionalIncludeIndirect(view, listOf(OneOnOneListView.TEAM))
                val counterpartId = params.uintOnlyForView("counterpartId", view, OneOnOneListView.WITH)
                // The auditor view (HR-only): view-shape validation like counterpartId above,
                // then the role gate (every use is audit-logged).
                val userId = params.uintOnlyForView("userId", view, OneOnOneListView.USER)
                if (view == OneOnOneListView.USER) {
                    requireAuditListAccess(caller, "oneOnOne", userId!!)
                }
                val filter = OneOnOneListFilter(
                    managerName = params.optionalString("managerName"),
                    subordinateName = params.optionalString("subordinateName"),
                    meetingDateGte = meetingDateGte,
                    meetingDateLte = meetingDateLte,
                    latestOnly = latestOnly,
                )
                val result = oneOnOneService.list(
                    view,
                    caller.userId,
                    filter,
                    paging,
                    includeIndirect = includeIndirect,
                    counterpartId = counterpartId,
                    targetUserId = userId,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<OneOnOnes> {
                val caller = call.oneOnOneCaller()
                val request = call.receive<OneOnOneCreateRequest>()
                // The manager is ALWAYS the author: the caller documents their own 1:1, so there
                // is no ADMIN create-on-behalf. The subordinate must be in the caller's
                // TRANSITIVE management chain (the chain rule, v2.33.0 — a skip-level 1:1 is its
                // own manager↔subordinate pair with its own chronology); authorship stays locked
                // to the creator like before.
                requireRelationship(
                    caller,
                    { oneOnOneService.managesSubordinate(caller.userId, request.subordinateId) },
                    "You may only document 1:1 meetings with reports in your management chain",
                )
                // After the authz guard (403 wins over 400): no NEW 1:1s for deactivated users.
                userService.requireNoDeactivatedUsers(listOf(request.subordinateId))
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
                val created = oneOnOneService.read(result.id)
                    .orVanished("1:1 meeting", result.id)
                // The creating manager always reads their own meeting (the cheap party rule).
                call.respond(HttpStatusCode.Created, created.copy(canShare = true))
            }
            get<OneOnOnes.Id> { route ->
                val read = readGuardedMeeting(call, route.id)
                // A share read shows the shared meeting only — never facts about the pair's other
                // meetings (see forSharee).
                val shown = if (read.via is ReadVia.Shared) read.meeting.forSharee() else read.meeting
                call.respond(
                    HttpStatusCode.OK,
                    shown.copy(
                        canShare = canShare(call.caller(), read.via, read.meeting),
                        sharedBy = (read.via as? ReadVia.Shared)?.sharerName,
                    ),
                )
            }
            put<OneOnOnes.Id> { route ->
                val existing = writeGuardedMeeting(call, route.id)
                val request = call.receive<OneOnOneUpdateRequest>()
                validateOneOnOnePayload(
                    request.meetingDate, request.points, request.decisions, request.actionItems,
                )
                // The latest-only + chronological write rules live in the service so they validate
                // atomically with the mutation (409 via ConflictException, mapped by StatusPages).
                val updated = oneOnOneService.replace(route.id, request)
                if (updated == 0) {
                    throw NotFoundException("1:1 meeting not found")
                }
                // Audit: one structured event per changed aspect, diffed against the pre-replace
                // document (added items need no ids in params, so the request suffices).
                oneOnOneUpdateEvents(existing, request).forEach { descriptor ->
                    oneOnOneEventService.create(descriptor.toEvent(route.id, call.caller().userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<OneOnOnes.Id> { route ->
                writeGuardedMeeting(call, route.id)
                // Latest-only rule (deleting an old meeting would rewrite history) is enforced in the
                // service, atomically with the soft-delete — 409 via ConflictException.
                if (oneOnOneService.delete(route.id) == 0) {
                    throw NotFoundException("1:1 meeting not found")
                }
                // Audit the deletion against the acting manager (events outlive the soft-deleted
                // row). No notification — creation is the only notifying event for 1:1s.
                oneOnOneEventService.create(oneOnOneDeletionEvent().toEvent(route.id, call.caller().userId))
                call.respond(HttpStatusCode.NoContent)
            }
            get<OneOnOnes.Id.Events> { route ->
                val meetingId = route.parent.id
                // Whoever may read the meeting may read its history.
                readGuardedMeeting(call, meetingId)
                call.respond(
                    HttpStatusCode.OK,
                    OneOnOneEventListResponse(oneOnOneEventService.listForMeeting(meetingId)),
                )
            }
            get<OneOnOnes.ActionItems.Id.History> { route ->
                val caller = call.oneOnOneCaller()
                val result = oneOnOneService.actionItemHistory(route.parent.id)
                    ?: throw NotFoundException("Action item not found")
                // One check covers the whole chain: every copy belongs to a meeting of the same
                // manager+subordinate pair, so the queried item's meeting is the authz anchor.
                // A missing meeting deliberately answers as the ITEM (the anchor is invisible
                // to the caller).
                val meeting = oneOnOneService.read(result.meetingId)
                    ?: throw NotFoundException("Action item not found")
                // OWN-RIGHT ONLY, deliberately NOT share-aware (v4.8.0): the chain spans carry-over
                // copies of the item across meetings that were never shared, so a share of one
                // meeting does not open it — a sharee gets this ordinary 403.
                oneOnOneService.requireReadable(caller, meeting)
                call.respond(HttpStatusCode.OK, ActionItemHistoryResponse(result.entries))
            }
        }
    }
}
