package ch.nokillswit.teams

import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.users.UserRef
import ch.nokillswit.users.UserService
import ch.nokillswit.users.currentProfilesByUserIds
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.select

/**
 * One person in a caller's transitive chain, with the facets the mass-share pickers show
 * (v4.11.0 — extracted from the v4.10.0 review share-candidates read so the reviews and the
 * days-off calendar endpoints run the same queries). This is ALSO the wire shape of the nine
 * shared fields: the days-off candidate list serializes it directly, and the reviews
 * `ShareCandidate` embeds it and flattens it back into its own object (checkup #38 M7 — one
 * declaration instead of three). [directManagers] are the managers of the person's teams minus
 * the person themselves — the caller appears there as themselves. [seniorityLevel] is always
 * attached: every row is the caller's own chain (the seniority-visibility rule). The three career
 * entries come from the person's CURRENT career position, null when none is recorded.
 */
@Serializable
data class ChainPerson(
    val userId: UInt,
    val name: String,
    val email: String,
    val deactivated: Boolean,
    val teams: List<TeamRef>,
    val directManagers: List<UserRef>,
    val careerPath: DictionaryEntry?,
    val careerSpecialization: DictionaryEntry?,
    val seniorityLevel: DictionaryEntry?,
)

/**
 * Every non-deleted person in [callerId]'s TRANSITIVE chain (deactivated INCLUDED with their
 * flag — the pyramid rule; the caller and strangers never appear), name-ascending then id.
 * Strictly caller-relative: no HR/ADMIN widening, nothing audited. Set-at-a-time — one chain
 * walk, then one query each for the users, the team memberships, the career profiles and the
 * names of managers outside the chain. **Must run inside a transaction** (the cross-feature
 * table-read rule); every query is drained before the next starts — a nested query inside a
 * still-open flow would deadlock the shared R2DBC connection.
 */
suspend fun chainRoster(callerId: UInt): List<ChainPerson> {
    val chain = transitiveSubordinateIds(callerId)
    if (chain.isEmpty()) return emptyList()
    val people = UserService.Users
        .select(
            UserService.Users.id,
            UserService.Users.name,
            UserService.Users.email,
            UserService.Users.deactivated,
        )
        .where { (UserService.Users.id inList chain) and (UserService.Users.markedAsDeleted eq false) }
        .toList()
    if (people.isEmpty()) return emptyList()
    val personIds = people.map { it[UserService.Users.id].value }.toSet()
    val memberships = teamMembershipsByUserIds(personIds)
    val profiles = currentProfilesByUserIds(personIds)
    val managerIds = memberships.entries
        .flatMap { (personId, edges) -> edges.map { it.managerId }.filter { it != personId } }
        .toSet()
    // Managers outside the chain (the caller, a dotted-line outsider): one lookup,
    // soft-deleted accounts included — a team may still name them.
    val outsideIds = managerIds - personIds
    val outsideNames = if (outsideIds.isEmpty()) emptyMap() else UserService.Users
        .select(UserService.Users.id, UserService.Users.name)
        .where { UserService.Users.id inList outsideIds }
        .toList()
        .associate { it[UserService.Users.id].value to it[UserService.Users.name] }
    val names = people.associate { it[UserService.Users.id].value to it[UserService.Users.name] } + outsideNames
    return people.map { person ->
        val personId = person[UserService.Users.id].value
        val edges = memberships[personId].orEmpty()
        val profile = profiles[personId]
        ChainPerson(
            userId = personId,
            name = person[UserService.Users.name],
            email = person[UserService.Users.email],
            deactivated = person[UserService.Users.deactivated],
            teams = edges.map { it.team }.sortedWith(compareBy({ it.name.lowercase() }, { it.id })),
            directManagers = edges.map { it.managerId }
                .filter { it != personId }
                .distinct()
                .map { UserRef(it, names[it] ?: "#$it") }
                .sortedWith(compareBy({ it.name.lowercase() }, { it.id })),
            careerPath = profile?.careerPath,
            careerSpecialization = profile?.careerSpecialization,
            seniorityLevel = profile?.seniorityLevel,
        )
    }.sortedWith(compareBy({ it.name.lowercase() }, { it.userId }))
}
