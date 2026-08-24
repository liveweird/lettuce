package ch.nokillswit.impactlog

import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.authz.requireImpactEntryRead
import ch.nokillswit.authz.requireImpactEntryWrite
import ch.nokillswit.infra.db.orVanished
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalIncludeIndirect
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.infra.paging.uintOnlyForView
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.users.Feature
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
@Resource("/api/v1/impact-log")
class ImpactLog {
    @Serializable
    @Resource("{id}")
    class Id(val parent: ImpactLog = ImpactLog(), val id: UInt) {
        @Serializable
        @Resource("events")
        class Events(val parent: Id)
    }
}

// Turn a structured event descriptor into the persistable audit event (the SPA localizes it).
private fun ImpactEntryEventDescriptor.toEvent(entryId: UInt, userId: UInt) = ImpactEntryEvent(
    entryId = entryId,
    userId = userId,
    type = type,
    params = params,
)

// The gated caller (V46): every impact-log handler resolves its principal through this, so the
// per-user IMPACT_LOG flag is enforced before any other guard or read.
private fun ApplicationCall.impactLogCaller() =
    caller().also { requireFeatureEnabled(it, Feature.IMPACT_LOG) }

fun Application.configureImpactLogRoutes() {
    val impactLogService = attributes[ImpactLogServiceKey]
    val eventService = attributes[ImpactLogEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]

    // The uniform read preamble (the 404-before-403 idiom): resolves the entry (missing →
    // NotFoundException) and enforces the read rule (owner / audited HR / the owner's transitive
    // chain — the guard itself throws ForbiddenException). Shared by the document and events GETs.
    suspend fun readGuardedEntry(call: ApplicationCall, entryId: UInt): ImpactEntryResponse {
        val caller = call.impactLogCaller()
        val entry = impactLogService.read(entryId)
            ?: throw NotFoundException("Impact log entry not found")
        requireImpactEntryRead(caller, entry) {
            impactLogService.managesOwner(caller.userId, entry.userId)
        }
        return entry
    }

    // The write sibling: owner-only (nobody else — the chain, ADMIN, and HR included). Guards
    // run BEFORE any body is received, so an outsider's malformed payload is still 403.
    suspend fun writeGuardedEntry(call: ApplicationCall, entryId: UInt): ImpactEntryResponse {
        // The gated caller resolves FIRST: an IMPACT_LOG-disabled caller gets a uniform 403
        // before the read (the feature 403 must precede the 404).
        val caller = call.impactLogCaller()
        val entry = impactLogService.read(entryId)
            ?: throw NotFoundException("Impact log entry not found")
        requireImpactEntryWrite(caller, entry)
        return entry
    }

    routing {
        authenticate {
            get<ImpactLog> {
                val caller = call.impactLogCaller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "own") {
                    "own" -> ImpactLogListView.OWN
                    "managed" -> ImpactLogListView.MANAGED
                    "user" -> ImpactLogListView.USER
                    else -> throw BadRequestException("Unknown view: $raw (allowed: own, managed, user)")
                }
                val paging = call.parsePaging(
                    sortable = setOf("id", "userName", "periodStart", "periodEnd", "createdAt", "lastModified"),
                    // A journal reads newest accomplishments first.
                    defaultSort = listOf(SortField("periodStart", descending = true)),
                )
                val includeIndirect =
                    params.optionalIncludeIndirect(view, listOf(ImpactLogListView.MANAGED))
                // The auditor view (HR-only): view-shape validation first, then the role gate
                // (every use is audit-logged) — the goals-list idiom.
                val userId = params.uintOnlyForView("userId", view, ImpactLogListView.USER)
                if (view == ImpactLogListView.USER) {
                    requireAuditListAccess(caller, "impactLog", userId!!)
                }
                val result = impactLogService.list(
                    view,
                    caller.userId,
                    ImpactLogListFilter(userName = params.optionalString("userName")),
                    paging,
                    includeIndirect = includeIndirect,
                    targetUserId = userId,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<ImpactLog> {
                // The owner is always the caller — no create-on-behalf exists at all, so the
                // feature gate is the only guard before the payload.
                val caller = call.impactLogCaller()
                val request = call.receive<ImpactEntryRequest>()
                validateImpactEntry(request)
                val (id, toNotify) = impactLogService.create(caller.userId, request)
                call.response.header(HttpHeaders.Location, call.application.href(ImpactLog.Id(id = id)))
                toNotify.forEach { notificationService.create(it) }
                eventService.create(
                    impactEntryCreationEvent(request.periodStart, request.periodEnd).toEvent(id, caller.userId),
                )
                val created = impactLogService.read(id)
                    .orVanished("Impact log entry", id)
                call.respond(HttpStatusCode.Created, created)
            }
            get<ImpactLog.Id> { route ->
                val entry = readGuardedEntry(call, route.id)
                call.respond(HttpStatusCode.OK, entry)
            }
            put<ImpactLog.Id> { route ->
                val existing = writeGuardedEntry(call, route.id)
                val edit = call.receive<ImpactEntryRequest>()
                validateImpactEntry(edit)
                val toNotify = impactLogService.update(route.id, edit)
                    ?: throw NotFoundException("Impact log entry not found")
                toNotify.forEach { notificationService.create(it) }
                // One UPDATED event naming the changed fields; a no-op PUT records nothing.
                impactEntryUpdateEvent(existing, edit)?.let { descriptor ->
                    eventService.create(descriptor.toEvent(route.id, call.caller().userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            get<ImpactLog.Id.Events> { route ->
                val entryId = route.parent.id
                // Whoever may read the entry may read its history.
                readGuardedEntry(call, entryId)
                call.respond(
                    HttpStatusCode.OK,
                    ImpactEntryEventListResponse(eventService.listForEntry(entryId)),
                )
            }
            delete<ImpactLog.Id> { route ->
                writeGuardedEntry(call, route.id)
                val toNotify = impactLogService.delete(route.id)
                    ?: throw NotFoundException("Impact log entry not found")
                toNotify.forEach { notificationService.create(it) }
                // Audit the deletion against the owner (events outlive the soft-deleted row).
                eventService.create(impactEntryDeletionEvent().toEvent(route.id, call.caller().userId))
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
