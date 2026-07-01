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
)

typealias TeamMemberPageResponse = PageResponse<TeamMemberListItem>
