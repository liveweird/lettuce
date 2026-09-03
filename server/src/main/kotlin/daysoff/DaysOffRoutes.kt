package ch.nokillswit.daysoff

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.ConflictException
import ch.nokillswit.authz.DaysOffReadGrant
import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requireDaysOffCorrectionsRead
import ch.nokillswit.authz.requireDaysOffCancel
import ch.nokillswit.authz.requireDaysOffRead
import ch.nokillswit.authz.requireDaysOffAllowanceWrite
import ch.nokillswit.authz.requireDaysOffResolve
import ch.nokillswit.authz.requireRelationship
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.infra.db.orVanished
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalIncludeIndirect
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.infra.validation.sanitizeSingleLine
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
import java.time.LocalDate
import kotlinx.serialization.Serializable

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
@Resource("/api/v1/days-off/allowance")
class DaysOffAllowance

@Serializable
@Resource("/api/v1/days-off/corrections")
class DaysOffCorrections {
    @Serializable
    @Resource("{id}")
    class Id(val parent: DaysOffCorrections = DaysOffCorrections(), val id: UInt)
}

// The per-user paid pools (v3.2.0): a DELETE-only sub-resource — grants are created/updated
// through PUT /days-off/allowance and read as GET /days-off/budgets rows (which carry the
// grant id as `poolId`).
@Serializable
@Resource("/api/v1/days-off/pools")
class DaysOffPools {
    @Serializable
    @Resource("{id}")
    class Id(val parent: DaysOffPools = DaysOffPools(), val id: UInt)
}

// The org-wide pool kinds registry (v3.2.0): everyone reads, ADMIN writes — the
// public-holidays shape.
@Serializable
@Resource("/api/v1/days-off/pool-types")
class DaysOffPoolTypes {
    @Serializable
    @Resource("{id}")
    class Id(val parent: DaysOffPoolTypes = DaysOffPoolTypes(), val id: UInt)
}

// The gated caller (V46): every days-off handler (requests, calendar, budgets, corrections)
// resolves its principal through this, so the per-user DAYS_OFF flag is enforced before any
// other guard or read.
private fun ApplicationCall.daysOffCaller() =
    caller().also { requireFeatureEnabled(it, Feature.DAYS_OFF) }

/** The shared budget-year bound (corrections list + budgets): 400 outside 2000..2100. */
private fun parseYearParam(raw: String): Int =
    raw.toIntOrNull()?.takeIf { it in 2000..2100 }
        ?: throw BadRequestException("year must be a four-digit year between 2000 and 2100")

fun Application.configureDaysOffRoutes() {
    val daysOffService = attributes[DaysOffServiceKey]
    val notificationService = attributes[NotificationServiceKey]
    val userService = attributes[UserServiceKey]

    // Shared handler for accept/reject: read (404 when missing), the resolve guard, the
    // service transition (409 on an invalid from-status), then the notifications it produced.
    suspend fun transitionTo(call: ApplicationCall, requestId: UInt, target: DaysOffStatus) {
        val caller = call.daysOffCaller()
        val existing = daysOffService.read(requestId)
            ?: throw NotFoundException("Days-off request not found")
        requireDaysOffResolve(caller) { daysOffService.managesOwner(caller.userId, existing.userId) }
        val toNotify = daysOffService.transition(requestId, caller.userId, target)
            ?: throw NotFoundException("Days-off request not found")
        toNotify.forEach { notificationService.create(it) }
        call.respond(HttpStatusCode.NoContent)
    }

    // Cancellation (reworked v2.31.0): owner or chain manager, any date while
    // REQUESTED/ACCEPTED, always with a mandatory reason. Guard BEFORE payload validation
    // (403 wins over 400); the reason lands encrypted on the row and both sides are notified.
    suspend fun cancelRequest(call: ApplicationCall, requestId: UInt) {
        val caller = call.daysOffCaller()
        val existing = daysOffService.read(requestId)
            ?: throw NotFoundException("Days-off request not found")
        requireDaysOffCancel(caller, existing) {
            daysOffService.managesOwner(caller.userId, existing.userId)
        }
        val request = call.receive<DaysOffCancelRequest>()
        validateDaysOffCancel(request)
        val toNotify = daysOffService.cancel(requestId, caller.userId, request.reason.trim())
            ?: throw NotFoundException("Days-off request not found")
        toNotify.forEach { notificationService.create(it) }
        // Withdrawing leave — possibly someone else's — is audited like the on-behalf
        // recording; never the reason (it is encrypted at rest, the correction-comment rule).
        audit(
            "days_off.cancelled",
            "byUserId" to caller.userId.toLong(),
            "targetUserId" to existing.userId.toLong(),
            "requestId" to requestId.toLong(),
            "fromStatus" to existing.status.name,
            "type" to existing.type.name,
            "poolTypeId" to existing.poolTypeId?.toLong(),
            "startDate" to existing.startDate,
            "endDate" to existing.endDate,
            "days" to existing.days,
        )
        call.respond(HttpStatusCode.NoContent)
    }

    // The corrections write preamble (the teamkpis writeGuarded* idiom): resolves the row
    // (missing → NotFoundException) and enforces the resolve right against the ROW's user —
    // the target user is immutable, so the guard never keys on a payload (the guard itself
    // throws ForbiddenException). Shared by the correction PUT and DELETE.
    suspend fun writeGuardedCorrection(call: ApplicationCall, correctionId: UInt): DaysOffCorrectionResponse {
        // The gated caller resolves FIRST: a DAYS_OFF-disabled caller gets a uniform 403
        // before the read (the feature 403 must precede the 404).
        val caller = call.daysOffCaller()
        val existing = daysOffService.readCorrection(correctionId)
            ?: throw NotFoundException("Days-off correction not found")
        requireDaysOffResolve(caller) { daysOffService.managesOwner(caller.userId, existing.userId) }
        return existing
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
                // Deliberately NOT uintOnlyForView (the shared helper): here userId doubles as
                // an ordinary pin-filter on view=managed, so only view=own rejects it.
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
                // includeIndirect (v2.32.0): widens view=managed from direct reports to the
                // whole transitive subtree (the drill-down's chain mode); 400 on other views.
                val includeIndirect = params.optionalIncludeIndirect(view, listOf(DaysOffListView.MANAGED))
                // The date bounds must be strict ISO — a malformed value would silently compare
                // as a garbage string against the VARCHAR column instead of filtering.
                val startDateGte = params.optionalString("startDate[gte]")?.also { parseDaysOffDate(it, "startDate[gte]") }
                val startDateLte = params.optionalString("startDate[lte]")?.also { parseDaysOffDate(it, "startDate[lte]") }
                val filter = DaysOffListFilter(
                    userName = params.optionalString("userName"),
                    userId = if (view == DaysOffListView.USER) null else userId,
                    type = params.optionalEnum<DaysOffType>("type"),
                    poolTypeId = params.optionalUInt("poolTypeId"),
                    status = params.optionalEnum<DaysOffStatus>("status"),
                    startDateGte = startDateGte,
                    startDateLte = startDateLte,
                )
                val result = daysOffService.list(
                    view,
                    caller.userId,
                    filter,
                    paging,
                    targetUserId = userId,
                    includeIndirect = includeIndirect,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<DaysOff> {
                val caller = call.daysOffCaller()
                // Without a userId the owner is the caller — a personal ask entering REQUESTED.
                // With one (v2.29.0; chain-wide since v2.33.0) a manager in that user's
                // TRANSITIVE chain records the entry on their behalf, born ACCEPTED with the
                // caller as resolver (the accept right makes a separate approval step
                // redundant); ADMIN/HR get nothing special.
                val request = call.receive<DaysOffCreateRequest>()
                val targetId = request.userId
                if (targetId != null) {
                    // Guard before validation — 403 wins over 400, the goals-create shape. The
                    // explicit self exclusion keeps a manager on their own roster from
                    // qualifying via their own team (the allowance-PUT idiom).
                    requireRelationship(
                        caller,
                        { targetId != caller.userId && daysOffService.managesOwner(caller.userId, targetId) },
                        "Only a manager in the report's management chain may record days off on their behalf",
                    )
                    // After the authz guard: no NEW entries for deactivated users (house rule).
                    userService.requireNoDeactivatedUsers(listOf(targetId))
                }
                val onBehalf = targetId != null
                validateDaysOffCreate(request)
                // Overlap (409 + instance), zero-cost (400), and the paid-budget sweep (409)
                // are checked in the service, atomically with the insert.
                val (id, toNotify) = daysOffService.create(
                    userId = targetId ?: caller.userId,
                    request = request,
                    recordedBy = caller.userId.takeIf { onBehalf },
                )
                call.response.header(HttpHeaders.Location, call.application.href(DaysOff.Id(id = id)))
                toNotify.forEach { notificationService.create(it) }
                val created = daysOffService.read(id)
                    .orVanished("Days-off request", id)
                if (targetId != null) {
                    // A manager writes to a subordinate's leave record — audited like the
                    // budget corrections (never any free text; there is none here anyway).
                    audit(
                        "days_off.recorded",
                        "byUserId" to caller.userId.toLong(),
                        "targetUserId" to targetId.toLong(),
                        "requestId" to id.toLong(),
                        "type" to request.type.name,
                        "poolTypeId" to created.poolTypeId?.toLong(),
                        "startDate" to request.startDate,
                        "endDate" to request.endDate,
                        "days" to created.days,
                    )
                }
                call.respond(HttpStatusCode.Created, created)
            }
            get<DaysOff.Id> { route ->
                val caller = call.daysOffCaller()
                val request = daysOffService.read(route.id)
                    ?: throw NotFoundException("Days-off request not found")
                val grant = requireDaysOffRead(
                    caller,
                    request,
                    managesOwner = { daysOffService.managesOwner(caller.userId, request.userId) },
                    sharesTeam = { daysOffService.sharesTeam(caller.userId, request.userId) },
                )
                // Calendar parity (v3.2.1): a teammate learns THAT a colleague is off, never the
                // paid pool ("Maternal leave") — the pool identity is redacted on that grant.
                val visible = if (grant == DaysOffReadGrant.TEAMMATE) request.redactPool() else request
                call.respond(HttpStatusCode.OK, visible)
            }
            post<DaysOff.Id.Accept> { route -> transitionTo(call, route.parent.id, DaysOffStatus.ACCEPTED) }
            post<DaysOff.Id.Reject> { route -> transitionTo(call, route.parent.id, DaysOffStatus.REJECTED) }
            post<DaysOff.Id.Cancel> { route -> cancelRequest(call, route.parent.id) }
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
                val year = params.optionalString("year")?.let(::parseYearParam)
                requireDaysOffCorrectionsRead(caller, userId) {
                    daysOffService.managesOwner(caller.userId, userId)
                }
                call.respond(HttpStatusCode.OK, DaysOffCorrectionList(daysOffService.listCorrections(userId, year)))
            }
            post<DaysOffCorrections> {
                val caller = call.daysOffCaller()
                val write = call.receive<DaysOffCorrectionWrite>()
                // Writes belong to the subordinate's management chain (the resolve right,
                // chain-wide since v2.33.0). Guard before validation — 403 wins over 400.
                requireDaysOffResolve(caller) { daysOffService.managesOwner(caller.userId, write.userId) }
                validateDaysOffCorrection(write)
                val (id, notification) = daysOffService.createCorrection(caller.userId, write)
                call.response.header(
                    HttpHeaders.Location,
                    call.application.href(DaysOffCorrections.Id(id = id)),
                )
                notificationService.create(notification)
                val created = daysOffService.readCorrection(id)
                    .orVanished("Days-off correction", id)
                // A manager mutates a subordinate's paid-leave entitlement — audited like every
                // other admin-ish mutation (v2.4.1; never the encrypted comment).
                audit(
                    "days_off_correction.created",
                    "byUserId" to caller.userId.toLong(),
                    "targetUserId" to write.userId.toLong(),
                    "correctionId" to id.toLong(),
                    "year" to write.year.toLong(),
                    "operation" to write.operation.name,
                    "days" to write.days,
                )
                call.respond(HttpStatusCode.Created, created)
            }
            put<DaysOffCorrections.Id> { route ->
                // The target user is immutable — the guard keys on the ROW's user, and the
                // service ignores the payload's userId.
                val existing = writeGuardedCorrection(call, route.id)
                val write = call.receive<DaysOffCorrectionWrite>()
                validateDaysOffCorrection(write)
                // The pool is create-only (v3.2.1 — a differing kind is refused, never silently
                // kept: the API-RES-004 lost-write shape; re-homing is delete + create).
                if (write.poolTypeId != null && write.poolTypeId != existing.poolTypeId) {
                    throw BadRequestException("The pool of a correction is immutable — delete and re-create it")
                }
                if (daysOffService.updateCorrection(route.id, write) == 0) {
                    throw NotFoundException("Days-off correction not found")
                }
                audit(
                    "days_off_correction.updated",
                    "byUserId" to call.caller().userId.toLong(),
                    "targetUserId" to existing.userId.toLong(),
                    "correctionId" to route.id.toLong(),
                    "yearFrom" to existing.year.toLong(),
                    "yearTo" to write.year.toLong(),
                    "operationTo" to write.operation.name,
                    "daysTo" to write.days,
                )
                call.respond(HttpStatusCode.NoContent)
            }
            delete<DaysOffCorrections.Id> { route ->
                val existing = writeGuardedCorrection(call, route.id)
                if (daysOffService.deleteCorrection(route.id) == 0) {
                    throw NotFoundException("Days-off correction not found")
                }
                audit(
                    "days_off_correction.deleted",
                    "byUserId" to call.caller().userId.toLong(),
                    "targetUserId" to existing.userId.toLong(),
                    "correctionId" to route.id.toLong(),
                    "year" to existing.year.toLong(),
                    "operation" to existing.operation.name,
                    "days" to existing.days,
                )
                call.respond(HttpStatusCode.NoContent)
            }
            get<DaysOffBudgets> {
                val caller = call.daysOffCaller()
                val params = call.request.queryParameters
                val year = params.optionalString("year")?.let(::parseYearParam) ?: LocalDate.now().year
                val view = params.optionalString("view") ?: "own"
                // includeIndirect (v2.32.0): widens view=managed from direct reports (the
                // resolve scope) to the whole transitive subtree — the drill-down's chain
                // mode; the standard strict-boolean shape rule, 400 with view=own.
                val includeIndirect = params.optionalBoolean("includeIndirect")
                if (includeIndirect != null && view != "managed") {
                    throw BadRequestException("includeIndirect is only supported for view=managed")
                }
                // canCorrect (chain-wide since v2.33.0): every managed-view row is in the
                // caller's subtree by construction, so all of them are correctable; own never.
                val userIds: Set<UInt> = when (view) {
                    "own" -> setOf(caller.userId)
                    "managed" -> if (includeIndirect == true) {
                        daysOffService.transitiveReports(caller.userId)
                    } else {
                        daysOffService.directReports(caller.userId)
                    }
                    else -> throw BadRequestException("Unknown view: $view (allowed: own, managed)")
                }
                call.respond(
                    HttpStatusCode.OK,
                    DaysOffBudgetList(daysOffService.budgets(userIds, year, correctable = view == "managed")),
                )
            }
            put<DaysOffAllowance> {
                val caller = call.daysOffCaller()
                val write = call.receive<DaysOffAllowanceWrite>()
                // The chain right (v2.32.0 — moved here from the ADMIN users PUT): guard
                // before validation (403 wins over 400); the explicit self exclusion keeps a
                // manager on their own roster from qualifying via their own team (the v2.29.0
                // on-behalf idiom). Unknown/soft-deleted targets land the same uniform 403.
                requireDaysOffAllowanceWrite(caller) {
                    write.userId != caller.userId && daysOffService.managesOwner(caller.userId, write.userId)
                }
                validateDaysOffAllowance(write)
                // v3.2.0: an upsert of the (user, pool kind) grant — the default kind when
                // poolTypeId is omitted; an unknown/archived kind is 400 (after the guard).
                val result = daysOffService.upsertPool(write.userId, write.poolTypeId, write.allowance)
                if (result.previous != write.allowance) {
                    // A chain manager reshaped a subordinate's paid budget — audited like the
                    // corrections; the owner hears about it (idempotent re-PUTs stay silent).
                    notificationService.create(
                        daysOffAllowanceChangedNotification(
                            ownerId = write.userId,
                            managerName = userService.read(caller.userId)?.name ?: "?",
                            poolName = result.kind.name,
                            from = result.previous,
                            to = write.allowance,
                        ),
                    )
                    val auditFields = mutableListOf<Pair<String, Any?>>(
                        "byUserId" to caller.userId.toLong(),
                        "targetUserId" to write.userId.toLong(),
                        "poolTypeId" to result.kind.id.toLong(),
                    )
                    result.previous?.let { auditFields += "allowanceFrom" to it.toLong() }
                    auditFields += "allowanceTo" to write.allowance.toLong()
                    audit("days_off.allowance_changed", *auditFields.toTypedArray())
                }
                call.respond(HttpStatusCode.NoContent)
            }
            // ── Paid pools (v3.2.0) ─────────────────────────────────────────────────────────
            delete<DaysOffPools.Id> { route ->
                // Archive a grant: the correction-write preamble (feature 403 → read 404 →
                // the resolve right against the ROW's user), then the default-kind refusal
                // (409 — the default pool is only ever overwritten, never removed).
                val caller = call.daysOffCaller()
                val existing = daysOffService.readPool(route.id)
                    ?: throw NotFoundException("Days-off pool not found")
                requireDaysOffResolve(caller) { daysOffService.managesOwner(caller.userId, existing.userId) }
                if (existing.kind.isDefault) {
                    throw ConflictException("The default days-off pool cannot be archived")
                }
                if (daysOffService.archivePool(route.id) == 0) {
                    throw NotFoundException("Days-off pool not found")
                }
                // No notification (the correction edit/delete precedent — the budget rows are
                // live); audited like the allowance change.
                audit(
                    "days_off_pool.archived",
                    "byUserId" to caller.userId.toLong(),
                    "targetUserId" to existing.userId.toLong(),
                    "poolId" to route.id.toLong(),
                    "poolTypeId" to existing.kind.id.toLong(),
                    "allowance" to existing.allowance.toLong(),
                )
                call.respond(HttpStatusCode.NoContent)
            }
            // ── The pool kinds registry (v3.2.0) ────────────────────────────────────────────
            get<DaysOffPoolTypes> {
                // Any authenticated caller (the create form's pool picker and the list filter
                // need it) — active kinds only, the public-holidays shape.
                call.daysOffCaller()
                call.respond(HttpStatusCode.OK, DaysOffPoolTypeList(daysOffService.listPoolTypes()))
            }
            post<DaysOffPoolTypes> {
                val caller = call.daysOffCaller()
                requireAdmin(caller)
                val write = call.receive<DaysOffPoolTypeWrite>()
                    .let { it.copy(name = sanitizeSingleLine(it.name, "Pool name")) }
                validatePoolTypeName(write.name)
                // A duplicate active name is the DB's partial unique index → 23505 → 409.
                val id = daysOffService.createPoolType(write)
                call.response.header(HttpHeaders.Location, call.application.href(DaysOffPoolTypes.Id(id = id)))
                audit(
                    "days_off_pool_type.created",
                    "byUserId" to caller.userId.toLong(),
                    "poolTypeId" to id.toLong(),
                    "name" to write.name,
                    "carriesOver" to write.carriesOver,
                )
                val created = daysOffService.readPoolType(id)
                    .orVanished("Days-off pool type", id)
                call.respond(HttpStatusCode.Created, created)
            }
            put<DaysOffPoolTypes.Id> { route ->
                val caller = call.daysOffCaller()
                requireAdmin(caller)
                val existing = daysOffService.readPoolType(route.id)
                    ?: throw NotFoundException("Days-off pool type not found")
                val write = call.receive<DaysOffPoolTypeWrite>()
                    .let { it.copy(name = sanitizeSingleLine(it.name, "Pool name")) }
                validatePoolTypeName(write.name)
                val grantsAffected = daysOffService.updatePoolType(route.id, write)
                    ?: throw NotFoundException("Days-off pool type not found")
                val fields = mutableListOf<Pair<String, Any?>>(
                    "byUserId" to caller.userId.toLong(),
                    "poolTypeId" to route.id.toLong(),
                )
                if (existing.name != write.name) {
                    fields += "nameFrom" to existing.name
                    fields += "nameTo" to write.name
                }
                if (existing.carriesOver != write.carriesOver) {
                    // A carry-over flip recomputes EVERY holder's history — the audit records
                    // how many active grants moved (v3.2.1, the grantsArchived precedent).
                    fields += "carriesOverFrom" to existing.carriesOver
                    fields += "carriesOverTo" to write.carriesOver
                    fields += "grantsAffected" to grantsAffected.toLong()
                }
                audit("days_off_pool_type.updated", *fields.toTypedArray())
                call.respond(HttpStatusCode.NoContent)
            }
            delete<DaysOffPoolTypes.Id> { route ->
                val caller = call.daysOffCaller()
                requireAdmin(caller)
                val existing = daysOffService.readPoolType(route.id)
                    ?: throw NotFoundException("Days-off pool type not found")
                if (existing.isDefault) {
                    throw ConflictException("The default days-off pool type cannot be archived")
                }
                // Archive (soft delete) — cascades to every active grant of the kind in the
                // same transaction; history keeps its label.
                val grantsArchived = daysOffService.archivePoolType(route.id)
                    ?: throw NotFoundException("Days-off pool type not found")
                audit(
                    "days_off_pool_type.archived",
                    "byUserId" to caller.userId.toLong(),
                    "poolTypeId" to route.id.toLong(),
                    "name" to existing.name,
                    "grantsArchived" to grantsArchived.toLong(),
                )
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
