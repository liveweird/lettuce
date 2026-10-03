package ch.nokillswit.perf

import ch.nokillswit.auth.hashPassword
import ch.nokillswit.teams.TeamService
import ch.nokillswit.users.OPT_IN_FEATURES
import ch.nokillswit.users.UserRole
import ch.nokillswit.users.UserService

/** Hierarchy depth: 1 = the CEO … 4 = an individual contributor; 0 = the HR auditor (outside the tree). */
object Level {
    const val HR = 0
    const val CEO = 1
    const val DIRECTOR = 2
    const val LEAD = 3
    const val IC = 4
}

class Person(
    val id: UInt,
    val name: String,
    val email: String,
    val level: Int,
    /** The direct manager (the manager of the team the person belongs to); null for the CEO and HR. */
    val managerId: UInt?,
    /** The team the person is a MEMBER of; null for the CEO and HR. */
    val teamId: UInt?,
)

class Team(val id: UInt, val name: String, val managerId: UInt, val memberIds: List<UInt>)

/**
 * The generated organisation: `people` in tree order (CEO, directors, leads, ICs), the HR auditor
 * last. Every non-CEO person belongs to exactly one team, the one their manager runs, so a person's
 * team manager is their direct manager and the management chain is the `managerId` walk.
 */
class Org(val people: List<Person>, val teams: List<Team>, val hr: Person) {
    val byId: Map<UInt, Person> = (people + hr).associateBy { it.id }
    val names: Map<UInt, String> = byId.mapValues { it.value.name }
    val reports: Map<UInt, List<Person>> = people.filter { it.managerId != null }.groupBy { it.managerId!! }
    val managed: List<Person> = people.filter { it.managerId != null }
    val ceo: Person = people.first()
    val teamById: Map<UInt, Team> = teams.associateBy { it.id }

    /** A person's teammates (same team, excluding them). */
    fun teammates(person: Person): List<UInt> =
        person.teamId?.let { teamById.getValue(it).memberIds.filter { id -> id != person.id } }.orEmpty()
}

private fun pad(number: Int, width: Int) = number.toString().padStart(width, '0')

/** Builds the people and teams with ids allocated from the given bases; nothing is written here. */
fun buildOrg(spec: SeedSpec, firstUserId: UInt, firstTeamId: UInt): Org {
    val userIds = IdCounter(firstUserId)
    val teamIds = IdCounter(firstTeamId)
    fun email(local: String) = "$local@$PERF_EMAIL_DOMAIN"

    val ceo = Person(userIds.take(), "Perf CEO", email("perf-ceo"), Level.CEO, null, null)
    val people = mutableListOf(ceo)
    val teams = mutableListOf<Team>()

    // The CEO's team holds the directors, a director's team its leads, a lead's team its ICs.
    val directorIds = List(spec.directors) { userIds.take() }
    val execTeamId = teamIds.take()
    directorIds.forEachIndexed { i, id ->
        people += Person(id, "Perf Director ${pad(i + 1, 2)}", email("perf-dir-${pad(i + 1, 2)}"), Level.DIRECTOR, ceo.id, execTeamId)
    }
    teams += Team(execTeamId, "Perf Executive", ceo.id, directorIds)

    val leadIds = List(spec.leads) { userIds.take() }
    val leadsPerDirector = spec.leads / spec.directors
    directorIds.forEachIndexed { d, directorId ->
        val teamId = teamIds.take()
        val members = leadIds.subList(d * leadsPerDirector, (d + 1) * leadsPerDirector)
        teams += Team(teamId, "Perf Division ${pad(d + 1, 2)}", directorId, members)
        members.forEachIndexed { k, id ->
            val n = d * leadsPerDirector + k + 1
            people += Person(id, "Perf Lead ${pad(n, 3)}", email("perf-lead-${pad(n, 3)}"), Level.LEAD, directorId, teamId)
        }
    }

    val perLead = spec.ics / spec.leads
    val extra = spec.ics % spec.leads
    var icNumber = 0
    leadIds.forEachIndexed { l, leadId ->
        val teamId = teamIds.take()
        val size = perLead + if (l < extra) 1 else 0
        val members = List(size) { userIds.take() }
        teams += Team(teamId, "Perf Team ${pad(l + 1, 3)}", leadId, members)
        members.forEach { id ->
            icNumber++
            people += Person(id, "Perf IC ${pad(icNumber, 4)}", email("perf-ic-${pad(icNumber, 4)}"), Level.IC, leadId, teamId)
        }
    }
    val hr = Person(userIds.take(), "Perf HR Auditor", email("perf-hr"), Level.HR, null, null)
    return Org(people, teams, hr)
}

/** Writes users (one shared bcrypt hash), roles, the two opt-in feature flags, teams and rosters. */
suspend fun seedOrg(ctx: SeedContext): Org {
    val db = ctx.db
    val org = buildOrg(ctx.spec, nextFreeId(db, UserService.Users), nextFreeId(db, TeamService.Teams))
    val passwordHash = hashPassword(PERF_PASSWORD) // bcrypt cost 12, once — every account shares it
    val rng = ctx.rng("users")

    val users = RowSink<Person>(db, UserService.Users) { p ->
        this[UserService.Users.id] = p.id
        this[UserService.Users.name] = p.name
        this[UserService.Users.email] = p.email
        this[UserService.Users.passwordHash] = passwordHash
        this[UserService.Users.language] = "en"
        // Most people signed in during the last month; ~10% never did (lastLoginAt 0 = never).
        this[UserService.Users.lastLoginAt] =
            if (rng.chance(0.9)) ctx.anchorMillis - rng.int(0, 30 * 24 * 60) * 60_000L else 0L
    }
    val roles = RowSink<Person>(db, UserService.UserRoles) { p ->
        this[UserService.UserRoles.userId] = p.id
        this[UserService.UserRoles.role] = UserRole.HR.name
    }
    val flags = RowSink<Pair<Person, String>>(db, UserService.UserDisabledFeatures) { (p, feature) ->
        this[UserService.UserDisabledFeatures.userId] = p.id
        this[UserService.UserDisabledFeatures.feature] = feature
    }
    val teams = RowSink<Team>(db, TeamService.Teams) { t ->
        this[TeamService.Teams.id] = t.id
        this[TeamService.Teams.name] = t.name
        this[TeamService.Teams.managerId] = t.managerId
    }
    val members = RowSink<Pair<UInt, UInt>>(db, TeamService.TeamMembers) { (teamId, userId) ->
        this[TeamService.TeamMembers.teamId] = teamId
        this[TeamService.TeamMembers.userId] = userId
    }

    (org.people + org.hr).forEach { p ->
        users.add(p)
        // The two inverted-default flags every created user starts with (UserService.create): without
        // the MFA row a login answers an MFA challenge instead of a token.
        OPT_IN_FEATURES.forEach { flags.add(p to it.name) }
    }
    roles.add(org.hr)
    org.teams.forEach { t ->
        teams.add(t)
        t.memberIds.forEach { members.add(t.id to it) }
    }
    SinkGroup(users, roles, flags, teams, members).flush()
    advanceSequences(db, listOf(UserService.Users, TeamService.Teams))
    return org
}
