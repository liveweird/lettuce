package ch.nokillswit.teams

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
)

@Serializable
data class TeamPageResponse(
    val items: List<TeamListItem>,
    val page: Int,
    val pageSize: Int,
    val total: Long,
)
