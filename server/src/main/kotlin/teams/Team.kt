package ch.nokillswit.teams

import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.infra.paging.PageResponse
import kotlinx.serialization.Serializable

@Serializable
data class Team(
    val name: String,
    val managerId: UInt,
    val memberIds: List<UInt> = emptyList(),
)

@Serializable
data class TeamResponse(
    val id: UInt,
    val name: String,
    val managerId: UInt,
    val memberIds: List<UInt>,
)

fun Team.toResponse(id: UInt) = TeamResponse(id, name, managerId, memberIds)

@Serializable
data class TeamListItem(
    val id: UInt,
    val name: String,
    val managerId: UInt,
    val managerName: String,
    val managerDeleted: Boolean,
)

typealias TeamPageResponse = PageResponse<TeamListItem>

@Serializable
data class TeamMemberListItem(
    val userId: UInt,
    val name: String,
    val email: String,
    val teamId: UInt,
    val teamName: String,
    // Dashboard stats. The 1:1/lastFeedbackAt trio is populated for view=managers and
    // view=managed (direction follows the view: managers — the row user is the meeting's
    // manager / feedback provider; managed — the caller is); the given/received pair below
    // is populated only for view=member, where both feedback directions show at once.
    /** ISO `YYYY-MM-DD` of the latest 1:1 of the (row user, caller) pair in the view's direction. */
    val lastOneOnOneDate: String? = null,
    /** Unresolved action items on that meeting; null exactly when [lastOneOnOneDate] is null. */
    val lastOneOnOneOpenItems: Int? = null,
    /**
     * Epoch ms of the last currently-SENT feedback in the view's direction: managers — this
     * manager last provided the caller feedback the caller can see; managed — the caller last
     * provided this member feedback (provider-side, never visibility-filtered).
     */
    val lastFeedbackAt: Long? = null,
    /**
     * Epoch ms of the SENT moment of the caller's newest currently-SENT feedback about this
     * peer (provider-side, never visibility-filtered — the caller authored it). Populated only
     * for view=member; null for the other views.
     */
    val lastFeedbackGivenAt: Long? = null,
    /**
     * Epoch ms of the SENT moment of the newest currently-SENT feedback this peer provided
     * about the caller that the caller can see (received-scoped — an invisible feedback never
     * leaks). Populated only for view=member; null for the other views.
     */
    val lastFeedbackReceivedAt: Long? = null,
    /**
     * ACTIVE goals of the (row user, caller) pair in the view's direction: managers — goals
     * this manager set for the caller; managed — goals the caller set for this member. `0`
     * when the pair has none (a count has no "absent" state on those views); null only for
     * view=member, which carries no goal stat.
     */
    val activeGoalCount: Int? = null,
    // The row user's career profile (v1.32.1), resolved from the dictionaries at read time —
    // populated for EVERY view (unlike the directional stats above); null = the field is unset.
    val careerPath: DictionaryEntry? = null,
    val careerSpecialization: DictionaryEntry? = null,
    val seniorityLevel: DictionaryEntry? = null,
)

typealias TeamMemberPageResponse = PageResponse<TeamMemberListItem>
