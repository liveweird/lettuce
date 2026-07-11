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
    // Dashboard stats, populated only for view=managers; null in every other view.
    /** ISO `YYYY-MM-DD` of the latest 1:1 run BY this manager with the caller as subordinate. */
    val lastOneOnOneDate: String? = null,
    /** Unresolved action items on that meeting; null exactly when [lastOneOnOneDate] is null. */
    val lastOneOnOneOpenItems: Int? = null,
    /** Epoch ms this manager last provided the caller feedback they can see (currently SENT). */
    val lastFeedbackAt: Long? = null,
)

typealias TeamMemberPageResponse = PageResponse<TeamMemberListItem>
