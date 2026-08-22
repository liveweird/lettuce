package ch.nokillswit.teamkpis

import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireRelationship
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.authz.requireTeamKpiManage
import ch.nokillswit.authz.requireTeamKpiReadAllowingChain
import ch.nokillswit.authz.requireTeamKpiValueWrite
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
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.notifications.NotificationType
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
@Resource("/api/v1/team-kpis")
class TeamKpis {
    @Serializable
    @Resource("{id}")
    class Id(val parent: TeamKpis = TeamKpis(), val id: UInt) {
        @Serializable
        @Resource("events")
        class Events(val parent: Id)

        // The KPI's data points: readable by whoever reads the KPI, mutable by the team's
        // manager, their chain, and the team's members while the KPI is ACTIVE (v2.26.0; the
        // definition PUT stays DRAFT-only and manager-or-chain).
        @Serializable
        @Resource("values")
        class Values(val parent: Id) {
            @Serializable
            @Resource("{valueId}")
            class ValueId(val parent: Values, val valueId: UInt)
        }

        // Lifecycle-transition actions (POST). The state machine gates which are valid from the
        // current status (invalid → 409); archive is the only bodied one (its required summary).
        @Serializable @Resource("activate") class Activate(val parent: Id)

        @Serializable @Resource("deactivate") class Deactivate(val parent: Id)

        @Serializable @Resource("archive") class Archive(val parent: Id)

        @Serializable @Resource("reopen") class Reopen(val parent: Id)
    }
}

// Turn a structured event descriptor into the persistable audit event (the SPA localizes it).
private fun TeamKpiEventDescriptor.toEvent(kpiId: UInt, userId: UInt) = TeamKpiEvent(
    kpiId = kpiId,
    userId = userId,
    type = type,
    params = params,
)

// The gated caller (V46): every team-KPI handler resolves its principal through this (via the
// shared read/write preambles or directly), so the per-user TEAM_KPIS flag is enforced before
// any other guard or read.
private fun ApplicationCall.teamKpiCaller() =
    caller().also { requireFeatureEnabled(it, Feature.TEAM_KPIS) }

fun Application.configureTeamKpiRoutes() {
    val kpiService = attributes[TeamKpiServiceKey]
    val kpiEventService = attributes[TeamKpiEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]

    // Fan out a data-point mutation to the team's current members + manager, minus the ACTOR
    // (v2.26.0 — members and chain managers record data too, so the actor is the caller, not
    // the manager). [existing] is the pre-mutation read with the display fields.
    suspend fun notifyValueChange(
        existing: TeamKpiResponse,
        kpiId: UInt,
        actorId: UInt,
        type: NotificationType,
        valueParams: Map<String, String>,
    ) {
        teamKpiValueNotifications(
            kpiId = kpiId,
            type = type,
            memberIds = kpiService.memberIds(existing.teamId),
            teamManagerId = existing.managerId,
            actorId = actorId,
            actorName = kpiService.actorName(actorId) ?: existing.managerName,
            title = existing.title,
            teamName = existing.teamName,
            kpiType = existing.type,
            valueParams = valueParams,
        ).forEach { notificationService.create(it) }
    }

    // The uniform read preamble (the 404-before-403 idiom): resolves the KPI (missing →
    // NotFoundException) and enforces the document read rule (manager / audited HR at any
    // status; member / chain once out of DRAFT — the guard itself throws ForbiddenException).
    // Shared by the document, values, and events GETs.
    suspend fun readGuardedKpi(call: ApplicationCall, kpiId: UInt): TeamKpiResponse {
        val caller = call.teamKpiCaller()
        val kpi = kpiService.read(kpiId)
            ?: throw NotFoundException("Team KPI not found")
        requireTeamKpiReadAllowingChain(
            caller,
            kpi,
            isTeamMember = { kpiService.isTeamMember(caller.userId, kpi.teamId) },
            managesTeamManager = { kpiService.managesManagerOf(caller.userId, kpi.managerId) },
        )
        return kpi
    }

    // The definition/lifecycle sibling (v2.26.0): the team's current manager + the chain above
    // (nobody else — members and ADMIN included). Guards run BEFORE any body is received, so
    // an outsider's malformed payload is still 403.
    suspend fun manageGuardedKpi(call: ApplicationCall, kpiId: UInt): TeamKpiResponse {
        // The gated caller resolves FIRST: a TEAM_KPIS-disabled caller gets a uniform 403
        // before the read (the feature 403 must precede the 404).
        val caller = call.teamKpiCaller()
        val kpi = kpiService.read(kpiId)
            ?: throw NotFoundException("Team KPI not found")
        requireTeamKpiManage(caller, kpi) { kpiService.managesManagerOf(caller.userId, kpi.managerId) }
        return kpi
    }

    // The data-point sibling (v2.26.0): manage rights OR current team membership — recording
    // measurements is the team's shared work; ACTIVE-only stays a service 409.
    suspend fun valueGuardedKpi(call: ApplicationCall, kpiId: UInt): TeamKpiResponse {
        val caller = call.teamKpiCaller()
        val kpi = kpiService.read(kpiId)
            ?: throw NotFoundException("Team KPI not found")
        requireTeamKpiValueWrite(
            caller,
            kpi,
            isTeamMember = { kpiService.isTeamMember(caller.userId, kpi.teamId) },
            managesTeamManager = { kpiService.managesManagerOf(caller.userId, kpi.managerId) },
        )
        return kpi
    }

    // Shared handler for the lifecycle-transition action endpoints: manager-or-chain (v2.26.0),
    // 404 when missing, 409 (via ConflictException in the service) when the KPI is not at the
    // edge's source status, otherwise it applies the change, delivers the notifications, and
    // records the audit event. Each endpoint names its whole edge (from AND target) — see
    // TeamKpiService.transition. The summary is only present (and required non-blank) when
    // archiving.
    suspend fun transitionTo(
        call: ApplicationCall,
        kpiId: UInt,
        from: TeamKpiStatus,
        target: TeamKpiStatus,
        receiveSummary: (suspend () -> String?)? = null,
    ) {
        val existing = manageGuardedKpi(call, kpiId)
        // The archive body is received (and validated) only after the write guard, so a
        // non-manager's malformed or blank summary is still 403 on a foreign KPI, not 400.
        // Validated only while the row sits at the edge's source status — an off-edge call
        // must reach the service so its status check answers the documented 409.
        val summary = receiveSummary?.invoke()
        if (existing.status == from && target == TeamKpiStatus.ARCHIVED) validateTeamKpiSummary(summary)
        val toNotify = kpiService.transition(kpiId, from, target, call.caller().userId, summary)
            ?: throw NotFoundException("Team KPI not found")
        toNotify.forEach { notificationService.create(it) }
        kpiEventService.create(teamKpiTransitionEvent(from, target).toEvent(kpiId, call.caller().userId))
        call.respond(HttpStatusCode.NoContent)
    }

    routing {
        authenticate {
            get<TeamKpis> {
                val caller = call.teamKpiCaller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "own") {
                    "own" -> TeamKpiListView.OWN
                    "managed" -> TeamKpiListView.MANAGED
                    else -> throw BadRequestException("Unknown view: $raw (allowed: own, managed)")
                }
                // Direct-vs-subtree scope (v2.26.0): only meaningful on view=managed, 400
                // elsewhere (the shared strict-boolean helper).
                val includeIndirect = params.optionalIncludeIndirect(view, listOf(TeamKpiListView.MANAGED))
                val paging = call.parsePaging(
                    sortable = setOf(
                        "id", "teamName", "managerName", "creatorName", "title", "type", "status",
                        "targetValue", "currentValue", "createdAt", "lastModified",
                    ),
                    defaultSort = listOf(SortField("createdAt", descending = true)),
                )
                val filter = TeamKpiListFilter(
                    teamName = params.optionalString("teamName"),
                    teamId = params.optionalUInt("teamId"),
                    title = params.optionalString("title"),
                    type = params.optionalEnum<TeamKpiType>("type"),
                    status = params.optionalEnum<TeamKpiStatus>("status"),
                    createdAtGte = params.optionalLong("createdAt[gte]"),
                    lastModifiedGte = params.optionalLong("lastModified[gte]"),
                )
                val result = kpiService.list(view, caller.userId, filter, paging, includeIndirect)
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<TeamKpis> {
                val caller = call.teamKpiCaller()
                val request = call.receive<TeamKpiCreateRequest>()
                // The author manages the team directly OR sits in the chain above its manager
                // (v2.26.0 — a KPI may be set anywhere in the caller's subtree; no
                // create-on-behalf beyond that, not even for ADMIN). Checked before payload
                // validation so an outsider's malformed request is still a uniform 403, not 400
                // — including for an unknown teamId.
                requireRelationship(
                    caller,
                    { kpiService.managesTeamOrChain(caller.userId, request.teamId) },
                    "You may only set KPIs for teams you manage directly or indirectly",
                )
                val id = requireValidReferences("Referenced team does not exist") {
                    kpiService.create(request, caller.userId)
                }
                call.response.header(HttpHeaders.Location, call.application.href(TeamKpis.Id(id = id)))
                // Audit: record the creation against the acting manager. No notification — the
                // KPI is a private draft until activated.
                kpiEventService.create(teamKpiCreationEvent(request.type).toEvent(id, caller.userId))
                val created = kpiService.read(id)
                    .orVanished("Team KPI", id)
                // The creator just passed the manage-or-chain gate, so both capability flags
                // are true by construction — stamped like the single GET.
                call.respond(HttpStatusCode.Created, created.copy(canManage = true, canRecordValues = true))
            }
            get<TeamKpis.Id> { route ->
                val kpi = readGuardedKpi(call, route.id)
                // Capability flags (v2.26.0): the SPA cannot walk management chains, so the
                // server states the caller's rights on the document itself. The short-circuits
                // keep THIS block to at most two queries; the read guard above may already have
                // evaluated the same predicates (its results aren't reusable here) — accepted:
                // 1–2 cheap extra queries on a single-document read (registered, backlog #8).
                val caller = call.caller()
                val canManage = caller.userId == kpi.managerId ||
                    kpiService.managesManagerOf(caller.userId, kpi.managerId)
                val canRecordValues = canManage || kpiService.isTeamMember(caller.userId, kpi.teamId)
                call.respond(HttpStatusCode.OK, kpi.copy(canManage = canManage, canRecordValues = canRecordValues))
            }
            put<TeamKpis.Id> { route ->
                val existing = manageGuardedKpi(call, route.id)
                val edit = call.receive<TeamKpiDefinitionUpdate>()
                // DRAFT-only (else 409) and per-type validation both happen in the service,
                // atomically with the update.
                val updated = kpiService.updateDefinition(route.id, edit)
                if (updated == 0) {
                    throw NotFoundException("Team KPI not found")
                }
                // Audit: one event per changed aspect; a no-op PUT records nothing.
                teamKpiDefinitionUpdateEvents(existing, edit).forEach { descriptor ->
                    kpiEventService.create(descriptor.toEvent(route.id, call.caller().userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            get<TeamKpis.Id.Values> { route ->
                // Whoever may read the KPI may read its data points (the KPI data tab and the
                // Graph tab both feed on them).
                val kpiId = route.parent.id
                readGuardedKpi(call, kpiId)
                call.respond(HttpStatusCode.OK, TeamKpiValueListResponse(kpiService.listValues(kpiId)))
            }
            post<TeamKpis.Id.Values> { route ->
                val kpiId = route.parent.id
                val existing = valueGuardedKpi(call, kpiId)
                val write = call.receive<TeamKpiValueWrite>()
                // ACTIVE-only (else 409) and the value/date checks both happen in the service;
                // a duplicate date raises 23505 → 409 via the central mapping.
                val newId = kpiService.addValue(kpiId, write)
                    ?: throw NotFoundException("Team KPI not found")
                notifyValueChange(
                    existing,
                    kpiId,
                    actorId = call.caller().userId,
                    NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER,
                    mapOf("date" to write.date!!, "value" to write.value!!.toString()),
                )
                kpiEventService.create(
                    teamKpiValueRecordedEvent(write.date, write.value)
                        .toEvent(kpiId, call.caller().userId),
                )
                call.response.header(
                    HttpHeaders.Location,
                    call.application.href(TeamKpis.Id.Values.ValueId(route, newId)),
                )
                call.respond(
                    HttpStatusCode.Created,
                    TeamKpiValueResponse(id = newId, date = write.date, value = write.value),
                )
            }
            put<TeamKpis.Id.Values.ValueId> { route ->
                val kpiId = route.parent.parent.id
                val existing = valueGuardedKpi(call, kpiId)
                val write = call.receive<TeamKpiValueWrite>()
                val correction = kpiService.correctValue(kpiId, route.valueId, write)
                    ?: throw NotFoundException("Team KPI data point not found")
                // An exact no-op corrected nothing — no event, no notification, still 204.
                if (correction.changed) {
                    notifyValueChange(
                        existing,
                        kpiId,
                        actorId = call.caller().userId,
                        NotificationType.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER,
                        mapOf(
                            "fromDate" to correction.old.date,
                            "fromValue" to correction.old.value.toString(),
                            "toDate" to write.date!!,
                            "toValue" to write.value!!.toString(),
                        ),
                    )
                    kpiEventService.create(
                        teamKpiValueCorrectedEvent(correction.old, write.date, write.value)
                            .toEvent(kpiId, call.caller().userId),
                    )
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<TeamKpis.Id.Values.ValueId> { route ->
                val kpiId = route.parent.parent.id
                val existing = valueGuardedKpi(call, kpiId)
                val removed = kpiService.removeValue(kpiId, route.valueId)
                    ?: throw NotFoundException("Team KPI data point not found")
                notifyValueChange(
                    existing,
                    kpiId,
                    actorId = call.caller().userId,
                    NotificationType.TEAM_KPI_VALUE_REMOVED_TO_MEMBER,
                    mapOf("date" to removed.date, "value" to removed.value.toString()),
                )
                kpiEventService.create(teamKpiValueRemovedEvent(removed).toEvent(kpiId, call.caller().userId))
                call.respond(HttpStatusCode.NoContent)
            }
            post<TeamKpis.Id.Activate> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.DRAFT, target = TeamKpiStatus.ACTIVE)
            }
            post<TeamKpis.Id.Deactivate> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.ACTIVE, target = TeamKpiStatus.DRAFT)
            }
            post<TeamKpis.Id.Archive> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.ACTIVE, target = TeamKpiStatus.ARCHIVED) {
                    call.receive<TeamKpiArchiveRequest>().summary
                }
            }
            post<TeamKpis.Id.Reopen> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.ARCHIVED, target = TeamKpiStatus.ACTIVE)
            }
            get<TeamKpis.Id.Events> { route ->
                // Whoever may read the KPI may read its history (the Graph tab feeds on it).
                val kpiId = route.parent.id
                readGuardedKpi(call, kpiId)
                call.respond(HttpStatusCode.OK, TeamKpiEventListResponse(kpiEventService.listForKpi(kpiId)))
            }
            delete<TeamKpis.Id> { route ->
                val existing = manageGuardedKpi(call, route.id)
                // Delete is a draft-only action; ACTIVE/ARCHIVED KPIs are archived (or reopened)
                // through the transitions instead, keeping the record.
                if (existing.status != TeamKpiStatus.DRAFT) {
                    throw BadRequestException("Only a draft team KPI may be deleted")
                }
                if (kpiService.delete(route.id) == 0) {
                    throw NotFoundException("Team KPI not found")
                }
                // Audit the deletion against the acting manager (events outlive the soft-deleted
                // row). No notification — deleting a private draft is invisible activity.
                kpiEventService.create(teamKpiDeletionEvent().toEvent(route.id, call.caller().userId))
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
