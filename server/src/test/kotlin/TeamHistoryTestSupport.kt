package ch.nokillswit

import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamService
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.contentType
import java.time.LocalDate
import java.util.UUID

/** JSON POST/PUT shorthands for the team-history route tests. */
internal suspend inline fun <reified T> HttpClient.postJson(path: String, body: T): HttpResponse =
    post(path) {
        contentType(ContentType.Application.Json)
        setBody(body)
    }

internal suspend inline fun <reified T> HttpClient.putJson(path: String, body: T): HttpResponse =
    put(path) {
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/** A [TeamService] whose "today" is [daysAgo] days back — the fixture for teams that already have history. */
internal fun teamServiceFrom(daysAgo: Long) =
    TeamService(TestServices.database, clock = { LocalDate.now().minusDays(daysAgo) })

internal suspend fun seedPerson(prefix: String, roles: Set<UserRole> = emptySet(), name: String = "Test"): Pair<UInt, String> {
    val email = uniqueEmail(prefix)
    return TestUsers.seed(email, "pw", name, roles) to email
}

/** A team created [daysAgo] days back with [managerId] and [memberIds], so its dated rows start then. */
internal suspend fun backdatedTeam(
    daysAgo: Long,
    managerId: UInt,
    memberIds: List<UInt> = emptyList(),
    name: String = "Hist-${UUID.randomUUID()}",
): UInt = teamServiceFrom(daysAgo).create(Team(name = name, managerId = managerId, memberIds = memberIds))
