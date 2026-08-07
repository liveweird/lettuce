package ch.nokillswit.daysoff

import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.authz.requireDaysOffCorrectionsRead
import ch.nokillswit.authz.requireDaysOffOwner
import ch.nokillswit.authz.requireDaysOffRead
import ch.nokillswit.authz.requireDaysOffResolve
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.plugins.respondProblem
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
import java.time.LocalDate

@Serializable
@Resource("/api/v1/days-off")
class DaysOff {
    @Serializable
    @Resource("{id}")
    class Id(val parent: DaysOff = DaysOff(), val id: UInt) {
        // Lifecycle actions (POST, no body). Accept/reject are the direct manager's resolution;
        // cancel is the owner's withdrawal. Invalid from-status → 409 (the service checks).
        @Serializable @Resource("accept") class Accept(val parent: Id)

        @Serializable @Resource("reject") class Reject(val parent: Id)

        @Serializable @Resource("cancel") class Cancel(val parent: Id)
    }
}

// Top-level resource classes (not nested under DaysOff): a nested sibling of the UInt-typed
// {id} would make Ktor try (and fail) to parse "calendar"/"budgets"/"corrections" as an id.
@Serializable
@Resource("/api/v1/days-off/calendar")
class DaysOffCalendar

@Serializable
@Resource("/api/v1/days-off/budgets")
class DaysOffBudgets

@Serializable
@Resource("/api/v1/days-off/corrections")
class DaysOffCorrections {
    @Serializable
    @Resource("{id}")
    class Id(val parent: DaysOffCorrections = DaysOffCorrections(), val id: UInt)
}

// The gated caller (V46): every days-off handler (requests, calendar, budgets, corrections)
// resolves its principal through this, so the per-user DAYS_OFF flag is enforced before any
// other guard or read.
private fun ApplicationCall.daysOffCaller() =
    caller().also { requireFeatureEnabled(it, Feature.DAYS_OFF) }

fun Application.configureDaysOffRoutes() {
    val daysOffService = attributes[DaysOffServiceKey]
    val notificationService = attributes[NotificationServiceKey]

    // Shared handler for the three lifecycle actions: read (404 when missing), the
    // action-specific guard, the service transition (409 on an invalid from-status or the
    // accepted-cancel date gate), then the notifications it produced.
    suspend fun transitionTo(call: ApplicationCall, requestId: UInt, target: DaysOffStatus) {
        val caller = call.daysOffCaller()
        val existing = daysOffService.read(requestId)
        if (existing == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Days-off request not found")
            return
        }
        when (target) {
            DaysOffStatus.ACCEPTED, DaysOffStatus.REJECTED ->
                requireDaysOffResolve(caller) { daysOffService.isDirectManagerOf(caller.userId, existing.userId) }
            DaysOffStatus.CANCELLED -> requireDaysOffOwner(caller, existing)
            else -> error("Not a transition target: $target")
        }
        val toNotify = daysOffService.transition(requestId, caller.userId, target)
        if (toNotify == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Days-off request not found")
            return
        }
        toNotify.forEach { notificationService.create(it) }
        call.respond(HttpStatusCode.NoContent)
    }

    routing {
        authenticate {
            get<DaysOff> {
                val caller = call.daysOffCaller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "own") {
                    "own" -> DaysOffListView.OWN
                    "managed" -> DaysOffListView.MANAGED
                    "user" -> DaysOffListView.USER
                    else -> throw BadRequestException("Unknown view: $raw (allowed: own, managed, user)")
                }
                val paging = call.parsePaging(
                    sortable = setOf("id", "userName", "startDate", "endDate", "type", "status", "days", "createdAt"),
                    defaultSort = listOf(SortField("startDate", descending = true)),
                )
                // The auditor view (HR-only): view-shape validation like the goals list, then
                // the role gate (every use is audit-logged). userId doubles as an ordinary
                // pin-filter on view=managed (the drill-down precedent); own is caller-implied.
                val userId = params.optionalUInt("userId")
                if (view == DaysOffListView.USER && userId == null) {
                    throw BadRequestException("userId is required for view=user")
                }
                if (view == DaysOffListView.OWN && userId != null) {
                    throw BadRequestException("userId is not supported for view=own")
                }
                if (view == DaysOffListView.USER) {
                    requireAuditListAccess(caller, "daysOff", userId!!)
                }
                // The date bounds must be strict ISO — a malformed value would silently compare
                // as a garbage string against the VARCHAR column instead of filtering.
                val startDateGte = params.optionalString("startDate[gte]")?.also { parseDaysOffDate(it, "startDate[gte]") }
                val startDateLte = params.optionalString("startDate[lte]")?.also { parseDaysOffDate(it, "startDate[lte]") }
                val filter = DaysOffListFilter(
                    userName = params.optionalString("userName"),
                    userId = if (view == DaysOffListView.USER) null else userId,
                    type = params.optionalEnum<DaysOffType>("type"),
                    status = params.optionalEnum<DaysOffStatus>("status"),
                    startDateGte = startDateGte,
                    startDateLte = startDateLte,
                )
                val result = daysOffService.list(view, caller.userId, filter, paging, targetUserId = userId)
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<DaysOff> {
                val caller = call.daysOffCaller()
                // The owner is always the caller — there is no create-on-behalf (not even for
                // ADMIN): a days-off request is a personal ask.
                val request = call.receive<DaysOffCreateRequest>()
                validateDaysOffCreate(request)
                // Overlap (409 + instance), zero-cost (400), and the paid-budget sweep (409)
                // are checked in the service, atomically with the insert.
                val (id, toNotify) = daysOffService.create(caller.userId, request)
                call.response.header(HttpHeaders.Location, call.application.href(DaysOff.Id(id = id)))
                toNotify.forEach { notificationService.create(it) }
                val created = daysOffService.read(id)
                    ?: error("Days-off request $id vanished between create and re-read")
                call.respond(HttpStatusCode.Created, created)
            }
            get<DaysOff.Id> { route ->
                val caller = call.daysOffCaller()
                val request = daysOffService.read(route.id)
                if (request == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Days-off request not found")
                    return@get
                }
                requireDaysOffRead(
                    caller,
                    request,
                    managesOwner = { daysOffService.managesOwner(caller.userId, request.userId) },
                    sharesTeam = { daysOffService.sharesTeam(caller.userId, request.userId) },
                )
                call.respond(HttpStatusCode.OK, request)
            }
            post<DaysOff.Id.Accept> { route -> transitionTo(call, route.parent.id, DaysOffStatus.ACCEPTED) }
            post<DaysOff.Id.Reject> { route -> transitionTo(call, route.parent.id, DaysOffStatus.REJECTED) }
            post<DaysOff.Id.Cancel> { route -> transitionTo(call, route.parent.id, DaysOffStatus.CANCELLED) }
            get<DaysOffCalendar> {
                val caller = call.daysOffCaller()
                val params = call.request.queryParameters
                val month = params.optionalString("month")
                    ?: throw BadRequestException("month is required (YYYY-MM)")
                parseDaysOffMonth(month)
                // Both scopes are intrinsically caller-relative (an empty managed scope is just
                // an empty user list), so any authenticated caller may ask for either.
                val scope = when (val raw = params.optionalString("scope") ?: "member") {
                    "member" -> DaysOffCalendarScope.MEMBER
                    "managed" -> DaysOffCalendarScope.MANAGED
                    else -> throw BadRequestException("Unknown scope: $raw (allowed: member, managed)")
                }
                call.respond(HttpStatusCode.OK, daysOffService.calendar(scope, caller.userId, month))
            }
            // ── Budget corrections (v1.43.0) ────────────────────────────────────────────────
            get<DaysOffCorrections> {
                val caller = call.daysOffCaller()
                val params = call.request.queryParameters
                val userId = params.optionalUInt("userId")
                    ?: throw BadRequestException("userId is required")
                val year = params.optionalString("year")?.let {
                    it.toIntOrNull()?.takeIf { y -> y in 2000..2100 }
                        ?: throw BadRequestException("year must be a four-digit year between 2000 and 2100")
                }
                requireDaysOffCorrectionsRead(caller, userId) {
                    daysOffService.managesOwner(caller.userId, userId)
                }
                call.respond(HttpStatusCode.OK, DaysOffCorrectionList(daysOffService.listCorrections(userId, year)))
            }
            post<DaysOffCorrections> {
                val caller = call.daysOffCaller()
                val write = call.receive<DaysOffCorrectionWrite>()
                // Writes belong to the subordinate's CURRENT direct managers (the resolve
                // right). Guard before validation — 403 wins over 400, the house convention.
                requireDaysOffResolve(caller) { daysOffService.isDirectManagerOf(caller.userId, write.userId) }
                validateDaysOffCorrection(write)
                val (id, notification) = daysOffService.createCorrection(caller.userId, write)
                call.response.header(
                    HttpHeaders.Location,
                    call.application.href(DaysOffCorrections.Id(id = id)),
                )
                notificationService.create(notification)
                val created = daysOffService.readCorrection(id)
                    ?: error("Days-off correction $id vanished between create and re-read")
                call.respond(HttpStatusCode.Created, created)
            }
            put<DaysOffCorrections.Id> { route ->
                val caller = call.daysOffCaller()
                val existing = daysOffService.readCorrection(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Days-off correction not found")
                    return@put
                }
                // The target user is immutable — the guard keys on the ROW's user, and the
                // service ignores the payload's userId.
                requireDaysOffResolve(caller) { daysOffService.isDirectManagerOf(caller.userId, existing.userId) }
                val write = call.receive<DaysOffCorrectionWrite>()
                validateDaysOffCorrection(write)
                if (daysOffService.updateCorrection(route.id, write) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Days-off correction not found")
                    return@put
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<DaysOffCorrections.Id> { route ->
                val caller = call.daysOffCaller()
                val existing = daysOffService.readCorrection(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Days-off correction not found")
                    return@delete
                }
                requireDaysOffResolve(caller) { daysOffService.isDirectManagerOf(caller.userId, existing.userId) }
                if (daysOffService.deleteCorrection(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Days-off correction not found")
                    return@delete
                }
                call.respond(HttpStatusCode.NoContent)
            }
            get<DaysOffBudgets> {
                val caller = call.daysOffCaller()
                val params = call.request.queryParameters
                val year = when (val raw = params.optionalString("year")) {
                    null -> LocalDate.now().year
                    else -> raw.toIntOrNull()?.takeIf { it in 2000..2100 }
                        ?: throw BadRequestException("year must be a four-digit year between 2000 and 2100")
                }
                val userIds: Set<UInt> = when (val raw = params.optionalString("view") ?: "own") {
                    "own" -> setOf(caller.userId)
                    // The manager's budget overview: direct reports only (the resolve scope).
                    "managed" -> daysOffService.directReports(caller.userId)
                    else -> throw BadRequestException("Unknown view: $raw (allowed: own, managed)")
                }
                call.respond(HttpStatusCode.OK, DaysOffBudgetList(daysOffService.budgets(userIds, year)))
            }
        }
    }
}
