package ch.nokillswit.pulse

import ch.nokillswit.teams.TeamRef
import kotlinx.serialization.Serializable

/**
 * The pulse read-view DTOs beyond the per-team results block (which lives with its math in
 * PulseAggregation.kt). None of these shapes may ever pair a user with an answer: participation
 * rows carry a bare yes/no, comments are author-free, trend points are aggregates.
 */

/** ADMIN's per-cycle counts — deliberately count-only (no teams, no names, no content). */
@Serializable
data class PulseParticipationCounts(
    val participantCount: Int,
    val responseCount: Int,
    /** responses / participants, 1dp percent (0.0 for an empty snapshot). */
    val responseRate: Double,
)

@Serializable
data class PulseParticipationMember(
    val userId: UInt,
    val name: String,
    val responded: Boolean,
)

@Serializable
data class PulseParticipationTeam(
    val teamId: UInt,
    val teamName: String,
    /** The team's current members who are participants of the cycle, name-ascending. */
    val members: List<PulseParticipationMember>,
)

@Serializable
data class PulseParticipationStatusResponse(val teams: List<PulseParticipationTeam>)

@Serializable
data class PulseCommentsResponse(
    /** Author-free, shuffled per request; empty when withheld. */
    val items: List<String>,
    val responseCount: Int,
    /** True when the scope has fewer than [MIN_PULSE_RESPONSES] responses — items withheld. */
    val insufficientResponses: Boolean,
)

@Serializable
enum class PulseTrendAvailability {
    OK,

    /** The point's scope had fewer than [MIN_PULSE_RESPONSES] responses (k-anonymity). */
    NOT_ENOUGH_RESPONSES,

    /** The caller did not respond in that cycle (the per-cycle fill gate; never set for HR). */
    NOT_A_RESPONDENT,
}

@Serializable
data class PulseTrendPoint(
    val cycleId: UInt,
    val closedAt: Long,
    val availability: PulseTrendAvailability,
    /** Null unless [availability] is OK. */
    val enps: Int? = null,
    /** Null for NOT_A_RESPONDENT (a non-respondent learns nothing about that cycle). */
    val responseCount: Int? = null,
    val responseRate: Double? = null,
    /**
     * Favorable% (4–5 among valid answers, 1dp) of the fixed driver; null unless [availability]
     * is OK — and null even then when every answer was "Not applicable". The rotating question
     * deliberately has no trend field: it changes between cycles, so trending it is meaningless.
     */
    val favorableQ2: Double? = null,
    val favorableQ3: Double? = null,
    val favorableQ4: Double? = null,
    val favorableQ5: Double? = null,
)

@Serializable
data class PulseTrendResponse(
    val teamId: UInt,
    val teamName: String,
    val mode: PulseAggregationMode,
    /** Non-cancelled CLOSED cycles, oldest first. */
    val points: List<PulseTrendPoint>,
)

/**
 * The packed per-sub-team comparison (v2.10.0): the parent team's own-members baseline plus
 * one subtree-scoped block per team directly below it. Pure composition — every row equals an
 * already-authorized single-team results query (parent direct / child subtree), each
 * independently k-withheld via [PulseTeamResults.insufficientResponses].
 */
@Serializable
data class PulseTeamComparison(
    val cycleId: UInt,
    val teamId: UInt,
    val teamName: String,
    /** The parent's direct-members scope (mode DIRECT) — includes the sub-team managers. */
    val ownMembers: PulseTeamResults,
    /** One subtree-scoped block per direct child team, name-ascending. */
    val subTeams: List<PulseTeamResults>,
)

/**
 * The multi-scope trend bundle (v2.11.0): the parent team's two own scopes plus one subtree
 * series per direct child, each a self-describing [PulseTrendResponse]. A series is identified
 * by its (teamId, mode) pair — the parent appears twice. The subtree series is always present,
 * even for a childless team (where it equals the direct one — deduped at compute time only).
 */
@Serializable
data class PulseTrendComparison(
    val teamId: UInt,
    val teamName: String,
    /** [own DIRECT, own SUBTREE, one SUBTREE per direct child team (name-ascending)]. */
    val series: List<PulseTrendResponse>,
)

@Serializable
data class PulseVisibleTeams(
    /** Teams the caller may open results for (own + managed + below; HR: all). */
    val resultsTeams: List<TeamRef>,
    /** Teams the caller may monitor (managed + below; HR: all; empty for non-managers). */
    val monitoredTeams: List<TeamRef>,
)
