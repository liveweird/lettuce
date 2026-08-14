package ch.nokillswit.pulse

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.ConflictException
import ch.nokillswit.authz.auditHrRead
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.isAdmin
import ch.nokillswit.authz.isHr
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.authz.requirePulseMonitorAccess
import ch.nokillswit.authz.requirePulseMyResponse
import ch.nokillswit.authz.requirePulseResultsAccess
import ch.nokillswit.authz.requirePulseTrendAccess
import ch.nokillswit.authz.requirePulseTrendComparisonAccess
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.plugins.respondProblem
import ch.nokillswit.settings.AppSettingsServiceKey
import ch.nokillswit.teams.TeamServiceKey
import ch.nokillswit.users.Feature
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Parameters
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.request.receive
import io.ktor.server.resources.get
import io.ktor.server.resources.href
import io.ktor.server.resources.post
import io.ktor.server.resources.put
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/api/v1/pulse-surveys")
class PulseSurveys {
    @Serializable
    @Resource("cycles")
    class Cycles(val parent: PulseSurveys = PulseSurveys()) {
        @Serializable
        @Resource("{id}")
        class Id(val parent: Cycles = Cycles(), val id: UInt) {
            // Lifecycle-transition actions (POST, bodyless, ADMIN). Invalid edge → 409.
            @Serializable @Resource("open") class Open(val parent: Id)

            @Serializable @Resource("close") class Close(val parent: Id)

            @Serializable @Resource("cancel") class Cancel(val parent: Id)

            // ADMIN's count-only view vs the managers' per-person yes/no view.
            @Serializable @Resource("participation") class Participation(val parent: Id)

            @Serializable @Resource("participation-status") class ParticipationStatus(val parent: Id)

            // The caller's own survey (edit-form prefill + upsert), OPEN-only both ways.
            @Serializable @Resource("my-response") class MyResponse(val parent: Id)

            @Serializable @Resource("results") class Results(val parent: Id)

            @Serializable @Resource("comments") class Comments(val parent: Id)
        }
    }

    @Serializable
    @Resource("trend")
    class Trend(val parent: PulseSurveys = PulseSurveys())

    // The multi-scope trend bundle (v2.11.0): own direct + own subtree + one subtree series
    // per direct child team. No mode param — each series is self-describing.
    @Serializable
    @Resource("trend-comparison")
    class TrendComparison(val parent: PulseSurveys = PulseSurveys())

    @Serializable
    @Resource("visible-teams")
    class VisibleTeams(val parent: PulseSurveys = PulseSurveys())

    @Serializable
    @Resource("settings")
    class Settings(val parent: PulseSurveys = PulseSurveys())
}

// The gated caller (V46): every pulse handler resolves its principal through this, so the
// per-user PULSE_SURVEYS flag is enforced before any other guard or read.
private fun ApplicationCall.pulseCaller() =
    caller().also { requireFeatureEnabled(it, Feature.PULSE_SURVEYS) }

// teamId is required on every team-scoped read; mode defaults to the direct-members scope.
private fun Parameters.requiredTeamId(): UInt =
    this["teamId"]?.toUIntOrNull() ?: throw BadRequestException("teamId is required")

private fun Parameters.aggregationMode(): PulseAggregationMode {
    val raw = this["mode"] ?: return PulseAggregationMode.DIRECT
    return PulseAggregationMode.fromWire(raw)
        ?: throw BadRequestException("Unknown mode: $raw (allowed: direct, subtree)")
}

/**
 * One trend point per closed cycle (oldest first) over one scope — shared by `/trend` and
 * `/trend-comparison`. The per-cycle fill gate applies POINT-WISE for non-HR callers
 * ([respondedCycleIds] null for HR): a cycle the caller sat out contributes a gap, not a
 * number (and no counts either); a scope under the k-floor keeps its counts but no scores.
 * [cycles] is a drained List — never nest queries inside an open flow (R2DBC deadlock).
 */
private suspend fun trendPoints(
    cycles: List<PulseCycleRow>,
    scope: Set<UInt>,
    respondedCycleIds: Set<UInt>?,
    responseService: PulseResponseService,
): List<PulseTrendPoint> = cycles.map { c ->
    if (respondedCycleIds != null && c.id !in respondedCycleIds) {
        PulseTrendPoint(
            cycleId = c.id,
            closedAt = c.closedAt ?: 0,
            availability = PulseTrendAvailability.NOT_A_RESPONDENT,
        )
    } else {
        val answers = responseService.answersForScope(c.id, scope)
        val participantCount = responseService.participantCountForScope(c.id, scope)
        if (answers.size < MIN_PULSE_RESPONSES) {
            PulseTrendPoint(
                cycleId = c.id,
                closedAt = c.closedAt ?: 0,
                availability = PulseTrendAvailability.NOT_ENOUGH_RESPONSES,
                responseCount = answers.size,
                responseRate = pulseResponseRate(answers.size, participantCount),
            )
        } else {
            PulseTrendPoint(
                cycleId = c.id,
                closedAt = c.closedAt ?: 0,
                availability = PulseTrendAvailability.OK,
                enps = aggregateEnps(answers.map { it.enps }).score,
                responseCount = answers.size,
                responseRate = pulseResponseRate(answers.size, participantCount),
                favorableQ2 = driverFavorablePct(answers, PulseDriverQuestion.Q2),
                favorableQ3 = driverFavorablePct(answers, PulseDriverQuestion.Q3),
                favorableQ4 = driverFavorablePct(answers, PulseDriverQuestion.Q4),
                favorableQ5 = driverFavorablePct(answers, PulseDriverQuestion.Q5),
            )
        }
    }
}

fun Application.configurePulseRoutes() {
    val cycleService = attributes[PulseCycleServiceKey]
    val responseService = attributes[PulseResponseServiceKey]
    val teamService = attributes[TeamServiceKey]
    val notificationService = attributes[NotificationServiceKey]
    val appSettingsService = attributes[AppSettingsServiceKey]

    // Row → API shape. The rotating question stays unspoiled for non-admins until the cycle
    // opens (and a cancelled cycle reveals nothing); the counts are ADMIN-list enrichment.
    fun toResponse(row: PulseCycleRow, admin: Boolean, counts: Pair<Int, Int>? = null) = PulseCycleResponse(
        id = row.id,
        status = row.status,
        plannedOpenDate = row.plannedOpenDate,
        plannedCloseDate = row.plannedCloseDate,
        rotatingQuestionEn = if (admin || row.status == PulseCycleStatus.OPEN || row.status == PulseCycleStatus.CLOSED) {
            row.rotatingQuestionTextEn
        } else {
            null
        },
        rotatingQuestionPl = if (admin || row.status == PulseCycleStatus.OPEN || row.status == PulseCycleStatus.CLOSED) {
            row.rotatingQuestionTextPl
        } else {
            null
        },
        createdAt = row.createdAt,
        openedAt = row.openedAt,
        closedAt = row.closedAt,
        cancelledAt = row.cancelledAt,
        lastModified = row.lastModified,
        participantCount = counts?.first,
        responseCount = counts?.second,
    )

    routing {
        authenticate {
            get<PulseSurveys.Cycles> {
                val caller = call.pulseCaller()
                val rows = cycleService.list()
                val admin = caller.isAdmin()
                val counts =
                    if (admin) cycleService.participationCounts(rows.map { it.id }.toSet())
                    else emptyMap()
                call.respond(
                    HttpStatusCode.OK,
                    PulseCycleList(rows.map { toResponse(it, admin, counts[it.id]) }),
                )
            }
            post<PulseSurveys.Cycles> {
                val caller = call.pulseCaller()
                requireAdmin(caller)
                val request = call.receive<PulseCycleCreateRequest>()
                validatePulseCycleDates(request.plannedOpenDate, request.plannedCloseDate)
                // 409 (not 400) when a SCHEDULED/OPEN cycle exists or the question bank is
                // empty — both are state conflicts, checked atomically with the insert.
                val id = cycleService.schedule(request)
                val created = cycleService.read(id)
                    ?: error("Pulse cycle $id vanished between create and re-read")
                audit(
                    "pulse_cycle.scheduled",
                    "byUserId" to caller.userId.toLong(),
                    "cycleId" to id.toLong(),
                    "plannedOpenDate" to request.plannedOpenDate,
                    "plannedCloseDate" to request.plannedCloseDate,
                    "rotatingQuestionEntryId" to created.rotatingQuestionEntryId.toLong(),
                )
                // Heads-up to everyone currently eligible — deliberately link-less (no survey
                // exists yet) and un-stored (the OPEN snapshot is taken later).
                notificationService.createAll(
                    pulseScheduledNotifications(
                        recipientIds = cycleService.eligibleUserIds(),
                        actorId = caller.userId,
                        plannedOpenDate = created.plannedOpenDate,
                        plannedCloseDate = created.plannedCloseDate,
                    ),
                )
                call.response.header(HttpHeaders.Location, call.application.href(PulseSurveys.Cycles.Id(id = id)))
                call.respond(HttpStatusCode.Created, toResponse(created, admin = true))
            }
            get<PulseSurveys.Cycles.Id> { route ->
                val caller = call.pulseCaller()
                val cycle = cycleService.read(route.id)
                if (cycle == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@get
                }
                val admin = caller.isAdmin()
                val counts = if (admin) cycleService.participationCounts(setOf(cycle.id))[cycle.id] else null
                call.respond(HttpStatusCode.OK, toResponse(cycle, admin, counts))
            }
            put<PulseSurveys.Cycles.Id> { route ->
                val caller = call.pulseCaller()
                requireAdmin(caller)
                val before = cycleService.read(route.id)
                if (before == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@put
                }
                val request = call.receive<PulseCycleUpdateRequest>()
                // Per-status rules (SCHEDULED: both dates; OPEN: close date only; else 409)
                // and shape validation live in the service, atomically with the update.
                if (cycleService.updateDates(route.id, request) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@put
                }
                audit(
                    "pulse_cycle.updated",
                    "byUserId" to caller.userId.toLong(),
                    "cycleId" to route.id.toLong(),
                    *buildList {
                        if (before.plannedOpenDate != request.plannedOpenDate) {
                            add("plannedOpenFrom" to before.plannedOpenDate)
                            add("plannedOpenTo" to request.plannedOpenDate)
                        }
                        if (before.plannedCloseDate != request.plannedCloseDate) {
                            add("plannedCloseFrom" to before.plannedCloseDate)
                            add("plannedCloseTo" to request.plannedCloseDate)
                        }
                    }.toTypedArray(),
                )
                call.respond(HttpStatusCode.NoContent)
            }
            post<PulseSurveys.Cycles.Id.Open> { route ->
                val caller = call.pulseCaller()
                requireAdmin(caller)
                val cycleId = route.parent.id
                val result = cycleService.open(cycleId)
                if (result == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@post
                }
                val cycle = cycleService.read(cycleId)
                    ?: error("Pulse cycle $cycleId vanished after opening")
                audit(
                    "pulse_cycle.opened",
                    "byUserId" to caller.userId.toLong(),
                    "cycleId" to cycleId.toLong(),
                    "participantCount" to result.participantIds.size,
                )
                notificationService.createAll(
                    pulseOpenedNotifications(
                        participantIds = result.participantIds,
                        actorId = caller.userId,
                        plannedCloseDate = cycle.plannedCloseDate,
                    ),
                )
                call.respond(HttpStatusCode.NoContent)
            }
            post<PulseSurveys.Cycles.Id.Close> { route ->
                val caller = call.pulseCaller()
                requireAdmin(caller)
                val cycleId = route.parent.id
                val result = cycleService.close(cycleId)
                if (result == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@post
                }
                val cycle = cycleService.read(cycleId)
                    ?: error("Pulse cycle $cycleId vanished after closing")
                audit(
                    "pulse_cycle.closed",
                    "byUserId" to caller.userId.toLong(),
                    "cycleId" to cycleId.toLong(),
                    "responseCount" to result.respondentIds.size,
                )
                // Results exist the moment the cycle closes — but only respondents are told
                // (and only they may look, HR aside).
                notificationService.createAll(
                    pulseResultsNotifications(
                        respondentIds = result.respondentIds,
                        actorId = caller.userId,
                        cycleId = cycleId,
                        plannedCloseDate = cycle.plannedCloseDate,
                    ),
                )
                call.respond(HttpStatusCode.NoContent)
            }
            post<PulseSurveys.Cycles.Id.Cancel> { route ->
                val caller = call.pulseCaller()
                requireAdmin(caller)
                val cycleId = route.parent.id
                val result = cycleService.cancel(cycleId)
                if (result == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@post
                }
                val cycle = cycleService.read(cycleId)
                    ?: error("Pulse cycle $cycleId vanished after cancelling")
                audit(
                    "pulse_cycle.cancelled",
                    "byUserId" to caller.userId.toLong(),
                    "cycleId" to cycleId.toLong(),
                    "fromStatus" to result.fromStatus.name,
                )
                // Only an OPEN cycle's cancellation notifies (participants were mid-survey);
                // a scheduled or already-closed one goes quietly.
                if (result.participantIds.isNotEmpty()) {
                    notificationService.createAll(
                        pulseCancelledNotifications(
                            participantIds = result.participantIds,
                            actorId = caller.userId,
                            plannedOpenDate = cycle.plannedOpenDate,
                        ),
                    )
                }
                call.respond(HttpStatusCode.NoContent)
            }
            get<PulseSurveys.Cycles.Id.Participation> { route ->
                val caller = call.pulseCaller()
                requireAdmin(caller)
                val cycle = cycleService.read(route.parent.id)
                if (cycle == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@get
                }
                // Counts only — the narrowed-ADMIN rule: enough to decide close/extend, never
                // aggregates, comments, or per-user status. A SCHEDULED cycle reads as zeros.
                val counts = cycleService.participationCounts(setOf(cycle.id))[cycle.id] ?: (0 to 0)
                call.respond(
                    HttpStatusCode.OK,
                    PulseParticipationCounts(
                        participantCount = counts.first,
                        responseCount = counts.second,
                        responseRate = pulseResponseRate(counts.second, counts.first),
                    ),
                )
            }
            get<PulseSurveys.Cycles.Id.ParticipationStatus> { route ->
                val caller = call.pulseCaller()
                val cycle = cycleService.read(route.parent.id)
                if (cycle == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@get
                }
                if (cycle.status != PulseCycleStatus.OPEN && cycle.status != PulseCycleStatus.CLOSED) {
                    throw ConflictException("Participation is available only for open and closed cycles")
                }
                // Managers monitor their managed teams and everything below; HR the whole org
                // (audited). No fill gate — monitoring is a role right, and rows carry a bare
                // yes/no, never content. Non-managers simply get an empty team list.
                val teams = if (caller.isHr()) {
                    auditHrRead("pulseParticipation", cycle.id, caller.userId)
                    teamService.allTeamRefs()
                } else {
                    teamService.teamRefs(teamService.managedTeamTreeIds(caller.userId))
                }
                val teamBlocks = teams.map { ref ->
                    val members = teamService.membersWithNames(ref.id)
                    val participantIds = responseService.participantUserIds(cycle.id, members.map { it.first }.toSet())
                    val respondedIds = responseService.respondedUserIds(cycle.id, participantIds)
                    PulseParticipationTeam(
                        teamId = ref.id,
                        teamName = ref.name,
                        members = members
                            .filter { it.first in participantIds }
                            .map { (userId, name) ->
                                PulseParticipationMember(
                                    userId = userId,
                                    name = name,
                                    responded = userId in respondedIds,
                                )
                            },
                    )
                }
                call.respond(HttpStatusCode.OK, PulseParticipationStatusResponse(teams = teamBlocks))
            }
            get<PulseSurveys.Cycles.Id.MyResponse> { route ->
                val caller = call.pulseCaller()
                val cycle = cycleService.read(route.parent.id)
                if (cycle == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@get
                }
                // Participant-only, and OPEN-only even for the owner — once the cycle closes,
                // saved answers are never served again (no copy-paste seed for the next cycle).
                requirePulseMyResponse(caller, cycle.status) {
                    responseService.isParticipant(cycle.id, caller.userId)
                }
                val response = responseService.myResponse(cycle.id, caller.userId)
                if (response == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "No response submitted yet")
                    return@get
                }
                call.respond(HttpStatusCode.OK, response)
            }
            put<PulseSurveys.Cycles.Id.MyResponse> { route ->
                val caller = call.pulseCaller()
                val cycle = cycleService.read(route.parent.id)
                if (cycle == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@put
                }
                requirePulseMyResponse(caller, cycle.status) {
                    responseService.isParticipant(cycle.id, caller.userId)
                }
                // Validation after the guards (403/409 win over 400); upsert = first submit or
                // full replace, editable until the admin closes the cycle.
                val request = validatePulseResponse(call.receive<PulseResponseSubmitRequest>())
                responseService.upsert(cycle.id, caller.userId, request)
                call.respond(HttpStatusCode.NoContent)
            }
            get<PulseSurveys.Cycles.Id.Results> { route ->
                val caller = call.pulseCaller()
                val cycle = cycleService.read(route.parent.id)
                if (cycle == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@get
                }
                // Status before identity (404 → 409 → 403): the answer for a non-closed cycle
                // is uniform for every caller, HR included — results never leak while OPEN and
                // never exist for CANCELLED.
                if (cycle.status != PulseCycleStatus.CLOSED) {
                    throw ConflictException("Results are available only for closed cycles")
                }
                val params = call.request.queryParameters
                val teamId = params.requiredTeamId()
                val mode = params.aggregationMode()
                val team = teamService.read(teamId)
                if (team == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@get
                }
                // The identity step: HR exempt from the fill gate (audited); everyone else —
                // ADMIN included — must have responded in THIS cycle and stay in-tree.
                requirePulseResultsAccess(
                    caller,
                    cycleId = cycle.id,
                    teamId = teamId,
                    hasResponded = { responseService.hasResponded(cycle.id, caller.userId) },
                    visibleTeamIds = { teamService.visibleTeamTreeIds(caller.userId) },
                )
                val scope = teamService.teamScopeMembers(teamId, subtree = mode == PulseAggregationMode.SUBTREE)
                val answers = responseService.answersForScope(cycle.id, scope)
                val participantCount = responseService.participantCountForScope(cycle.id, scope)
                // The immediately preceding non-cancelled closed cycle, over the SAME scope.
                val previousCycle = cycleService.closedCyclesAsc()
                    .filter { (it.closedAt ?: 0) < (cycle.closedAt ?: 0) }
                    .maxByOrNull { it.closedAt ?: 0 }
                val previous = previousCycle?.let {
                    PulsePreviousCycleData(
                        cycleId = it.id,
                        answers = responseService.answersForScope(it.id, scope),
                        sameRotatingEntry = it.rotatingQuestionEntryId == cycle.rotatingQuestionEntryId,
                    )
                }
                call.respond(
                    HttpStatusCode.OK,
                    buildTeamResults(
                        cycleId = cycle.id,
                        teamId = teamId,
                        teamName = team.name,
                        mode = mode,
                        participantCount = participantCount,
                        answers = answers,
                        rotatingTextEn = cycle.rotatingQuestionTextEn,
                        rotatingTextPl = cycle.rotatingQuestionTextPl,
                        previous = previous,
                    ),
                )
            }
            get<PulseSurveys.Cycles.Id.Comments> { route ->
                val caller = call.pulseCaller()
                val cycle = cycleService.read(route.parent.id)
                if (cycle == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Pulse cycle not found")
                    return@get
                }
                if (cycle.status != PulseCycleStatus.CLOSED) {
                    throw ConflictException("Comments are available only for closed cycles")
                }
                val params = call.request.queryParameters
                val teamId = params.requiredTeamId()
                val mode = params.aggregationMode()
                val team = teamService.read(teamId)
                if (team == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@get
                }
                // Managers-and-above only (their monitored tree; HR org-wide, audited) — a
                // plain member never reads comments, and no fill gate applies (a monitoring
                // right, not a results view).
                requirePulseMonitorAccess(
                    caller,
                    cycleId = cycle.id,
                    teamId = teamId,
                    monitoredTeamIds = { teamService.managedTeamTreeIds(caller.userId) },
                )
                val scope = teamService.teamScopeMembers(teamId, subtree = mode == PulseAggregationMode.SUBTREE)
                val responseCount = responseService.respondedUserIds(cycle.id, scope).size
                if (responseCount < MIN_PULSE_RESPONSES) {
                    call.respond(
                        HttpStatusCode.OK,
                        PulseCommentsResponse(
                            items = emptyList(),
                            responseCount = responseCount,
                            insufficientResponses = true,
                        ),
                    )
                    return@get
                }
                call.respond(
                    HttpStatusCode.OK,
                    PulseCommentsResponse(
                        items = responseService.commentsForScope(cycle.id, scope),
                        responseCount = responseCount,
                        insufficientResponses = false,
                    ),
                )
            }
            get<PulseSurveys.Trend> {
                val caller = call.pulseCaller()
                val params = call.request.queryParameters
                val teamId = params.requiredTeamId()
                val mode = params.aggregationMode()
                val team = teamService.read(teamId)
                if (team == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@get
                }
                // Team scope as results (HR org-wide, audited); the fill gate instead applies
                // point-wise below.
                requirePulseTrendAccess(
                    caller,
                    teamId = teamId,
                    visibleTeamIds = { teamService.visibleTeamTreeIds(caller.userId) },
                )
                val scope = teamService.teamScopeMembers(teamId, subtree = mode == PulseAggregationMode.SUBTREE)
                val respondedCycleIds = if (caller.isHr()) null else responseService.respondedCycleIds(caller.userId)
                val points = trendPoints(cycleService.closedCyclesAsc(), scope, respondedCycleIds, responseService)
                call.respond(
                    HttpStatusCode.OK,
                    PulseTrendResponse(teamId = teamId, teamName = team.name, mode = mode, points = points),
                )
            }
            get<PulseSurveys.TrendComparison> {
                val caller = call.pulseCaller()
                val teamId = call.request.queryParameters.requiredTeamId()
                val team = teamService.read(teamId)
                if (team == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@get
                }
                // Checked on the PARENT only — the visible tree is transitive, so every child
                // series is a team the caller could query alone via /trend.
                requirePulseTrendComparisonAccess(
                    caller,
                    teamId = teamId,
                    visibleTeamIds = { teamService.visibleTeamTreeIds(caller.userId) },
                )
                // Everything cycle-independent resolved once; series built sequentially.
                val cycles = cycleService.closedCyclesAsc()
                val respondedCycleIds = if (caller.isHr()) null else responseService.respondedCycleIds(caller.userId)
                val directScope = teamService.teamScopeMembers(teamId, subtree = false)
                val subtreeScope = teamService.teamScopeMembers(teamId, subtree = true)
                val children = teamService.teamRefs(teamService.childTeamIds(teamId))
                val directPoints = trendPoints(cycles, directScope, respondedCycleIds, responseService)
                // Childless teams: the subtree scope IS the direct scope — reuse the points
                // (PulseTrendPoint carries no mode) instead of re-decrypting every cycle. The
                // series itself is always present: the contract stays uniformly 3-family.
                val subtreePoints =
                    if (subtreeScope == directScope) directPoints
                    else trendPoints(cycles, subtreeScope, respondedCycleIds, responseService)
                val series = buildList {
                    add(PulseTrendResponse(teamId, team.name, PulseAggregationMode.DIRECT, directPoints))
                    add(PulseTrendResponse(teamId, team.name, PulseAggregationMode.SUBTREE, subtreePoints))
                    children.forEach { child ->
                        val childScope = teamService.teamScopeMembers(child.id, subtree = true)
                        val childPoints = trendPoints(cycles, childScope, respondedCycleIds, responseService)
                        add(PulseTrendResponse(child.id, child.name, PulseAggregationMode.SUBTREE, childPoints))
                    }
                }
                call.respond(
                    HttpStatusCode.OK,
                    PulseTrendComparison(teamId = teamId, teamName = team.name, series = series),
                )
            }
            get<PulseSurveys.VisibleTeams> {
                val caller = call.pulseCaller()
                // Just team names/ids (readable by any authenticated user via /teams anyway) —
                // no audit needed for the HR branch.
                if (caller.isHr()) {
                    val all = teamService.allTeamRefs()
                    call.respond(
                        HttpStatusCode.OK,
                        PulseVisibleTeams(resultsTeams = all, monitoredTeams = all, memberTeams = all),
                    )
                    return@get
                }
                call.respond(
                    HttpStatusCode.OK,
                    PulseVisibleTeams(
                        resultsTeams = teamService.teamRefs(teamService.visibleTeamTreeIds(caller.userId)),
                        monitoredTeams = teamService.teamRefs(teamService.managedTeamTreeIds(caller.userId)),
                        memberTeams = teamService.teamRefs(teamService.membershipTeamIds(caller.userId)),
                    ),
                )
            }
            get<PulseSurveys.Settings> {
                val caller = call.pulseCaller()
                // ADMIN both ways (the alerts reads-included posture): the values only prefill
                // the admin scheduling form, nobody else consumes them.
                requireAdmin(caller)
                call.respond(HttpStatusCode.OK, appSettingsService.pulseSettings())
            }
            put<PulseSurveys.Settings> {
                val caller = call.pulseCaller()
                requireAdmin(caller)
                val request = call.receive<PulseSettings>()
                validatePulseSettings(request)
                val before = appSettingsService.pulseSettings()
                appSettingsService.savePulseSettings(request)
                audit(
                    "pulse_settings.updated",
                    "byUserId" to caller.userId.toLong(),
                    *buildList {
                        if (before.cadenceWeeks != request.cadenceWeeks) {
                            add("cadenceWeeksFrom" to before.cadenceWeeks)
                            add("cadenceWeeksTo" to request.cadenceWeeks)
                        }
                        if (before.openDays != request.openDays) {
                            add("openDaysFrom" to before.openDays)
                            add("openDaysTo" to request.openDays)
                        }
                    }.toTypedArray(),
                )
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
