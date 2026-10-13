package ch.nokillswit.teams

import ch.nokillswit.infra.parseIsoDateStrict
import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import kotlinx.serialization.Serializable

/*
 * The team-history sub-resources (v4.17.0): DTOs, the pure payload validators and the pure
 * manager-line maths. The writes live in TeamHistoryService; the dates follow teams/TeamStructure.kt
 * (strict ISO strings, null start = since before records, null end = open, end inclusive).
 */

/** `POST /teams/{id}/memberships`. */
@Serializable
data class TeamMembershipCreate(
    val userId: UInt,
    val startDate: String? = null,
    val endDate: String? = null,
)

/** `PUT /teams/{id}/memberships/{membershipId}` — the person is fixed once a row exists. */
@Serializable
data class TeamMembershipWrite(
    val startDate: String? = null,
    val endDate: String? = null,
)

/** One membership period; the nullable dates carry no default so an absent bound encodes as an explicit null. */
@Serializable
data class TeamMembershipResponse(
    val id: UInt,
    val userId: UInt,
    val userName: String,
    val userDeleted: Boolean,
    val deactivated: Boolean,
    val startDate: String?,
    val endDate: String?,
    val current: Boolean,
)

/** Unpaged, chronological (a null start first). */
@Serializable
data class TeamMembershipList(val items: List<TeamMembershipResponse>)

/** `POST`/`PUT` on the manager line; the period's end is always derived from the next start. */
@Serializable
data class TeamManagerPeriodWrite(
    val managerId: UInt,
    val startDate: String? = null,
)

@Serializable
data class TeamManagerPeriodResponse(
    val id: UInt,
    val managerId: UInt,
    val managerName: String,
    val managerDeleted: Boolean,
    val startDate: String?,
    val endDate: String?,
    val current: Boolean,
)

@Serializable
data class TeamManagerPeriodList(val items: List<TeamManagerPeriodResponse>)

/** The team a person-history row belongs to. */
@Serializable
data class TeamPeriodTeam(val id: UInt, val name: String, val deleted: Boolean)

/** One period (membership or managed-team) in `GET /users/{id}/team-history`. */
@Serializable
data class UserTeamPeriod(
    val id: UInt,
    val team: TeamPeriodTeam,
    val startDate: String?,
    val endDate: String?,
    val current: Boolean,
)

@Serializable
data class UserTeamHistory(
    val memberships: List<UserTeamPeriod>,
    val managerPeriods: List<UserTeamPeriod>,
)

private const val MIN_PERIOD_YEAR = 1900
private const val MAX_PERIOD_YEAR = 9999

/** A strict ISO day within years 1900..9999 (a derived end one day before year 0 would overflow the column). */
private fun parsePeriodDate(value: String, label: String): LocalDate {
    val date = parseIsoDateStrict(value, label)
    if (date.year !in MIN_PERIOD_YEAR..MAX_PERIOD_YEAR) {
        throw BadRequestException("$label must be in the years $MIN_PERIOD_YEAR to $MAX_PERIOD_YEAR")
    }
    return date
}

/** Strict ISO dates in years 1900..9999 (400 otherwise) and `endDate` not before `startDate` (400). */
internal fun validatePeriodDates(startDate: String?, endDate: String?) {
    val start = startDate?.let { parsePeriodDate(it, "startDate") }
    val end = endDate?.let { parsePeriodDate(it, "endDate") }
    if (start != null && end != null && end.isBefore(start)) {
        throw BadRequestException("endDate must not be before startDate")
    }
}

internal fun validateManagerPeriodStart(startDate: String?) {
    startDate?.let { parsePeriodDate(it, "startDate") }
}

/**
 * The managers whose coverage of today-or-later days GREW from [old] to [proposed]: a proposed period
 * not contained (from [iso] on) in an old period of the same manager. A manager newly assigned, or a
 * neighbour absorbing days, shows up here — and must then be an active, non-deleted user.
 */
internal fun grownManagers(old: List<ManagerRow>, proposed: List<ManagerRow>, iso: String): Set<UInt> =
    proposed
        .filter { next ->
            reachesFrom(next.end, iso) &&
                old.none { it.managerId == next.managerId && !extendsFrom(it.start, it.end, next.start, next.end, iso) }
        }
        .map { it.managerId }
        .toSet()

/** One period of a manager line being rebuilt; a null [id] is a row about to be inserted. */
internal data class DesiredPeriod(val id: UInt?, val managerId: UInt, val start: String?)

/** Folds each run of equal managers into its earliest period (that row's end then reaches the run's end). */
internal fun mergeAdjacent(periods: List<DesiredPeriod>): List<DesiredPeriod> {
    val merged = mutableListOf<DesiredPeriod>()
    periods.forEach { period ->
        if (merged.lastOrNull()?.managerId != period.managerId) merged += period
    }
    return merged
}

/** The derived end of each period: the day before the next start; the last period stays open. */
internal fun derivedEnds(periods: List<DesiredPeriod>): List<String?> =
    periods.indices.map { i ->
        periods.getOrNull(i + 1)?.let { next ->
            val start = checkNotNull(next.start) { "Only the first period of a line may have a null start" }
            LocalDate.parse(start).minusDays(1).toString()
        }
    }
