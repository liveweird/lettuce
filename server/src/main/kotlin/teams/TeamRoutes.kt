package ch.nokillswit.teams

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireCanReassignManager
import ch.nokillswit.authz.requireSelfOrAdmin
import ch.nokillswit.authz.requireTeamManagerOrAdmin
import ch.nokillswit.daysoff.DaysOffServiceKey
import ch.nokillswit.feedbacks.FeedbackServiceKey
import ch.nokillswit.goals.GoalServiceKey
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.oneonones.OneOnOneLatestStats
import ch.nokillswit.oneonones.OneOnOneServiceKey
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.plugins.respondProblem
import ch.nokillswit.reviews.LatestReviewStats
import ch.nokillswit.reviews.PerformanceReviewServiceKey
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
@Resource("/api/v1/teams")
class Teams {
    @Serializable
    @Resource("members")
    class Members(val parent: Teams = Teams())

    @Serializable
    @Resource("{id}")
    class Id(val parent: Teams = Teams(), val id: UInt) {
        @Serializable
        @Resource("members/{userId}")
        class Member(val parent: Id, val userId: UInt)
    }
}

// Column limit (teams.name varchar(100)) enforced up-front: 400 instead of a DB-level 500.
private const val MAX_TEAM_NAME_LENGTH = 100

private fun validateTeamName(name: String) {
    if (name.isBlank()) throw BadRequestException("Team name must not be blank")
    if (name.length > MAX_TEAM_NAME_LENGTH) {
        throw BadRequestException("Team name must be at most $MAX_TEAM_NAME_LENGTH characters")
    }
}

// The managers/managed enrichment: one 1:1 stat, one feedback stat, and the active-goal count,
// whose direction the caller chose by which service methods it queried (see the call site).
private fun List<TeamMemberListItem>.withDirectionalStats(
    oneOnOnes: Map<UInt, OneOnOneLatestStats>,
    feedbackAt: Map<UInt, Long>,
    activeGoals: Map<UInt, Int>,
): List<TeamMemberListItem> = map {
    it.copy(
        lastOneOnOneDate = oneOnOnes[it.userId]?.meetingDate,
        lastOneOnOneOpenItems = oneOnOnes[it.userId]?.openActionItemCount,
        lastFeedbackAt = feedbackAt[it.userId],
        // A count has no "absent" state on these views — a pair with no active goals shows 0.
        activeGoalCount = activeGoals[it.userId] ?: 0,
    )
}

// The managed-only extra (v1.34.0): the caller's latest authored performance review per member.
private fun List<TeamMemberListItem>.withLastReviews(
    reviews: Map<UInt, LatestReviewStats>,
): List<TeamMemberListItem> = map { item ->
    val review = reviews[item.userId] ?: return@map item
    item.copy(
        lastReviewId = review.reviewId,
        lastReviewPeriodStartMonth = review.periodStartMonth,
        lastReviewPeriodEndMonth = review.periodEndMonth,
        lastReviewStatus = review.status,
    )
}

fun Application.configureTeamRoutes() {
    val teamService = attributes[TeamServiceKey]
    // For the members-list dashboard stats (feedback stats on all three views, 1:1 stats on
    // managers/managed) and the career-profile triple (every view) — composed here at the
    // route so TeamService never touches other features' tables.
    val oneOnOneService = attributes[OneOnOneServiceKey]
    val feedbackService = attributes[FeedbackServiceKey]
    val goalService = attributes[GoalServiceKey]
    val userService = attributes[UserServiceKey]
    val performanceReviewService = attributes[PerformanceReviewServiceKey]
    val daysOffService = attributes[DaysOffServiceKey]

    routing {
        authenticate {
            get<Teams> {
                call.caller()
                val paging = call.parsePaging(sortable = setOf("id", "name"))
                val params = call.request.queryParameters
                val filter = TeamListFilter(
                    name = params.optionalString("name"),
                    managerId = params.optionalUInt("managerId"),
                    memberId = params.optionalUInt("memberId"),
                )
                val result = teamService.list(filter, paging)
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            get<Teams.Members> {
                val caller = call.caller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "member") {
                    "member" -> TeamMemberListView.MEMBER
                    "managed" -> TeamMemberListView.MANAGED
                    "managers" -> TeamMemberListView.MANAGERS
                    else -> throw BadRequestException("Unknown view: $raw (allowed: member, managed, managers)")
                }
                val includeIndirect = params.optionalBoolean("includeIndirect")
                if (includeIndirect != null && view != TeamMemberListView.MANAGED) {
                    throw BadRequestException("includeIndirect is only supported for view=managed")
                }
                val paging = call.parsePaging(sortable = setOf("id", "name", "email", "teamName"))
                val filter = TeamMemberListFilter(
                    name = params.optionalString("name"),
                    email = params.optionalString("email"),
                    teamId = params.optionalUInt("teamId"),
                )
                val result = teamService.listMembers(
                    view,
                    caller.userId,
                    filter,
                    paging,
                    includeIndirect = includeIndirect == true,
                )
                // Every view carries per-person dashboard stats, direction switched per view:
                // managers — the row user ran the 1:1 / provided the caller feedback
                // (received-scoped); managed — the caller did, toward the row user
                // (provider-side, regardless of includeIndirect), plus the caller's latest
                // authored performance review; member — both feedback
                // directions at once (given provider-side, received received-scoped), with no
                // 1:1 stat (peers don't run 1:1s with each other). Page-scoped; rows are one
                // per (user, team), so a user with several shared teams repeats the same stats.
                val items = if (result.items.isEmpty()) result.items else {
                    val ids = result.items.map { it.userId }.toSet()
                    val withStats = when (view) {
                        // Peers also see each other's next accepted vacation (calendar parity —
                        // ACCEPTED rows are on the shared team calendar) but never budgets.
                        TeamMemberListView.MEMBER -> {
                            val given = feedbackService.lastProvidedTo(caller.userId, ids)
                            val received = feedbackService.lastProvidedAt(ids, caller.userId)
                            val vacations = daysOffService.nextAcceptedVacationsByUserIds(ids)
                            result.items.map {
                                it.copy(
                                    lastFeedbackGivenAt = given[it.userId],
                                    lastFeedbackReceivedAt = received[it.userId],
                                    nextVacationStart = vacations[it.userId],
                                )
                            }
                        }
                        // No days-off stats here: budgets are manager/self-scoped, and a
                        // manager's requests aren't generally visible to their reports — the
                        // card omits rather than half-answers.
                        TeamMemberListView.MANAGERS -> result.items.withDirectionalStats(
                            oneOnOneService.latestMeetingStats(ids, caller.userId),
                            feedbackService.lastProvidedAt(ids, caller.userId),
                            goalService.activeGoalCountsByManager(ids, caller.userId),
                        )
                        TeamMemberListView.MANAGED -> {
                            val vacations = daysOffService.nextAcceptedVacationsByUserIds(ids)
                            val remaining = daysOffService.remainingByUserIds(
                                ids,
                                java.time.LocalDate.now().year,
                            )
                            result.items.withDirectionalStats(
                                oneOnOneService.latestMeetingStatsBySubordinate(caller.userId, ids),
                                feedbackService.lastProvidedTo(caller.userId, ids),
                                goalService.activeGoalCountsBySubordinate(caller.userId, ids),
                            ).withLastReviews(
                                performanceReviewService.latestReviewsBySubordinate(caller.userId, ids),
                            ).map {
                                it.copy(
                                    nextVacationStart = vacations[it.userId],
                                    daysOffRemaining = remaining[it.userId],
                                )
                            }
                        }
                    }
                    // Career profile (v1.32.1): view-independent — the person cards show it on
                    // every grid, so every view's rows carry the resolved triple.
                    val profiles = userService.careerProfilesByUserIds(ids)
                    withStats.map {
                        val profile = profiles[it.userId]
                        it.copy(
                            careerPath = profile?.careerPath,
                            careerSpecialization = profile?.careerSpecialization,
                            seniorityLevel = profile?.seniorityLevel,
                        )
                    }
                }
                call.respond(HttpStatusCode.OK, paging.toPage(items, result.total))
            }
            post<Teams> {
                val caller = call.caller()
                val team = call.receive<Team>()
                requireSelfOrAdmin(caller, team.managerId)
                validateTeamName(team.name)
                // Every reference is new at create — a deactivated member or manager is a 400.
                userService.requireNoDeactivatedUsers(team.memberIds.toSet() + team.managerId)
                val id = requireValidReferences("Referenced user does not exist") {
                    teamService.create(team)
                }
                audit(
                    "team.created",
                    "byUserId" to caller.userId.toLong(),
                    "teamId" to id.toLong(),
                    "managerId" to team.managerId.toLong(),
                )
                call.response.header(HttpHeaders.Location, call.application.href(Teams.Id(id = id)))
                call.respond(HttpStatusCode.Created, team.toResponse(id))
            }
            get<Teams.Id> { route ->
                call.caller()
                val team = teamService.read(route.id)
                if (team != null) {
                    call.respond(HttpStatusCode.OK, team.toResponse(route.id))
                } else {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                }
            }
            put<Teams.Id> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@put
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                val team = call.receive<Team>()
                // Authz before validation: an unauthorized reassignment is 403, not 400.
                requireCanReassignManager(caller, existing.managerId, team.managerId)
                validateTeamName(team.name)
                // Delta only: newly added members and a CHANGED manager. Resubmitting a member
                // already on the roster (or the unchanged manager) is not a new assignment —
                // a team containing a since-deactivated user must stay editable.
                userService.requireNoDeactivatedUsers(
                    (team.memberIds.toSet() - existing.memberIds.toSet()) +
                        (if (team.managerId != existing.managerId) setOf(team.managerId) else emptySet()),
                )
                val updated = requireValidReferences("Referenced user does not exist") {
                    teamService.update(route.id, team)
                }
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@put
                }
                // Team mutations shape who may read subordinates' feedback (the management
                // chain), so they are audited like user.role_changed. Delta fields only when
                // something actually changed.
                val auditFields = mutableListOf<Pair<String, Any?>>(
                    "byUserId" to caller.userId.toLong(),
                    "teamId" to route.id.toLong(),
                )
                if (team.managerId != existing.managerId) {
                    auditFields += "managerFrom" to existing.managerId.toLong()
                    auditFields += "managerTo" to team.managerId.toLong()
                }
                val added = team.memberIds.toSet() - existing.memberIds.toSet()
                val removed = existing.memberIds.toSet() - team.memberIds.toSet()
                if (added.isNotEmpty()) auditFields += "membersAdded" to added.joinToString(",")
                if (removed.isNotEmpty()) auditFields += "membersRemoved" to removed.joinToString(",")
                audit("team.updated", *auditFields.toTypedArray())
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Teams.Id> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@delete
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                if (teamService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@delete
                }
                audit(
                    "team.deleted",
                    "byUserId" to caller.userId.toLong(),
                    "teamId" to route.id.toLong(),
                )
                call.respond(HttpStatusCode.NoContent)
            }
            put<Teams.Id.Member> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.parent.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@put
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                // Only an actually-new member is a new assignment — re-PUT of an existing
                // (possibly deactivated) member stays the idempotent no-op it is today.
                if (route.userId !in existing.memberIds) {
                    userService.requireNoDeactivatedUsers(listOf(route.userId))
                }
                val changed = requireValidReferences("Referenced user does not exist") {
                    teamService.addMember(route.parent.id, route.userId)
                }
                if (changed == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@put
                }
                // Membership shapes the management chain — only audit when something actually changed.
                if (changed) {
                    audit(
                        "team.member_added",
                        "byUserId" to caller.userId.toLong(),
                        "teamId" to route.parent.id.toLong(),
                        "memberUserId" to route.userId.toLong(),
                    )
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Teams.Id.Member> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.parent.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@delete
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                val changed = teamService.removeMember(route.parent.id, route.userId)
                if (changed == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@delete
                }
                if (changed) {
                    audit(
                        "team.member_removed",
                        "byUserId" to caller.userId.toLong(),
                        "teamId" to route.parent.id.toLong(),
                        "memberUserId" to route.userId.toLong(),
                    )
                }
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
