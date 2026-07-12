package ch.nokillswit.teams

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
    // Dashboard stats, populated for view=managers and view=managed; null for view=member.
    // Direction follows the view: managers — the row user is the meeting's manager / feedback
    // provider; managed — the caller is.
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
)

typealias TeamMemberPageResponse = PageResponse<TeamMemberListItem>
