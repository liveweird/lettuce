package ch.nokillswit.users

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireCareerPositionRead
import ch.nokillswit.authz.requireCareerPositionWrite
import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.infra.db.orVanished
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.notifications.NotificationServiceKey
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.request.receive
import io.ktor.server.resources.delete
import io.ktor.server.resources.get
import io.ktor.server.resources.href
import io.ktor.server.resources.post
import io.ktor.server.resources.put
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import java.time.LocalDate

@Serializable
@Resource("/api/v1/users/{id}/career-positions")
class UserCareerPositions(val id: UInt) {
    @Serializable
    @Resource("{positionId}")
    class Position(val parent: UserCareerPositions, val positionId: UInt)
}

/** The caller-relative team-pyramid read (v2.16.0) — the dashboard/summary two-segment shape. */
@Serializable
@Resource("/api/v1/career/pyramid")
class CareerPyramid

/** A (dictionary, id) ref to validate — only when [requested] actually changes [current]. */
private fun changedRef(dict: Dictionary, requested: UInt?, current: UInt?): Pair<Dictionary, UInt>? =
    requested?.takeIf { it != current }?.let { dict to it }

/** The write's changed refs vs [current] (null current = a create, where every set ref is new). */
private fun changedRefs(
    write: CareerPositionWrite,
    current: CareerPositionService.PositionRow?,
): List<Pair<Dictionary, UInt>> = listOfNotNull(
    changedRef(Dictionary.CAREER_PATH, write.careerPathId, current?.careerPathId),
    changedRef(Dictionary.CAREER_SPECIALIZATION, write.careerSpecializationId, current?.careerSpecializationId),
    changedRef(Dictionary.SENIORITY_LEVEL, write.seniorityLevelId, current?.seniorityLevelId),
)

/**
 * A row's effective end within its chronological run: the day before the next row's start,
 * or — final row only — the stored deactivation end (null = open-ended current position).
 */
private fun effectiveEndDate(rows: List<CareerPositionService.PositionRow>, i: Int): String? =
    rows.getOrNull(i + 1)?.let { LocalDate.parse(it.startDate).minusDays(1).toString() } ?: rows[i].endDate

/** Chronological rows → responses: resolve refs and derive each end from the next start. */
private fun toResponses(
    rows: List<CareerPositionService.PositionRow>,
    entries: Map<UInt, DictionaryEntry>,
): List<CareerPositionResponse> = rows.mapIndexed { i, row ->
    CareerPositionResponse(
        id = row.id,
        startDate = row.startDate,
        endDate = effectiveEndDate(rows, i),
        careerPath = row.careerPathId?.let { entries[it] },
        careerSpecialization = row.careerSpecializationId?.let { entries[it] },
        seniorityLevel = row.seniorityLevelId?.let { entries[it] },
        createdAt = row.createdAt,
        lastModified = row.lastModified,
    )
}

/**
 * The career position timeline sub-resource (v2.15.0). Reads are restricted since v2.25.0
 * (the seniority-privacy round) to the user themselves, their TRANSITIVE management chain,
 * and HR (audited `hr.read`) — the read mirror of the write rule below; the GET still 404s a
 * missing/soft-deleted user BEFORE the guard (the corrections idiom — user existence is no
 * secret given the open users list), so unknown → 404, known-but-forbidden → 403. Writes
 * belong to the target's TRANSITIVE management chain ONLY — deliberately wider than the
 * days-off corrections' direct-manager writes (career progression is the chain's shared
 * record), and deliberately excluding ADMIN (the management role lost the career write in
 * v2.15.0; reads followed in v2.25.0), HR (read-only auditor), and — writes only — the user
 * themselves.
 */
fun Application.configureCareerPositionRoutes() {
    val userService = attributes[UserServiceKey]
    val careerPositionService = attributes[CareerPositionServiceKey]
    val notificationService = attributes[NotificationServiceKey]

    // The corrections writeGuarded* idiom for the row-addressed mutations: resolve the row
    // (NotFoundException when missing, soft-deleted, or belonging to a different user than the
    // path says), then enforce the chain right against the ROW's user — the target is
    // immutable, so the guard never keys on a payload.
    suspend fun writeGuardedPosition(
        call: ApplicationCall,
        pathUserId: UInt,
        positionId: UInt,
    ): CareerPositionService.PositionRow {
        val caller = call.caller()
        val existing = careerPositionService.readRow(positionId)
        if (existing == null || existing.userId != pathUserId) {
            throw NotFoundException("Career position not found")
        }
        requireCareerPositionWrite(caller) { careerPositionService.managesUser(caller.userId, existing.userId) }
        return existing
    }

    routing {
        authenticate {
            // Caller-relative (v2.16.0): any authenticated caller; a non-manager simply gets
            // an empty list (the days-off budgets idiom — no 403). No role widening: HR and
            // ADMIN see exactly their own subordinates — every row is the caller's chain, so
            // the v2.25.0 seniority rule (self/chain/HR) is satisfied by construction.
            get<CareerPyramid> {
                val caller = call.caller()
                val includeIndirect = call.request.queryParameters.optionalBoolean("includeIndirect")
                val data = careerPositionService.pyramidRows(caller.userId, includeIndirect == true)
                val entries = userService.resolveEntryRefs(
                    *data.users.flatMap { user ->
                        user.positions.flatMap {
                            listOf(it.careerPathId, it.careerSpecializationId, it.seniorityLevelId)
                        }
                    }.toTypedArray(),
                )
                call.respond(
                    HttpStatusCode.OK,
                    CareerPyramidList(
                        items = data.users.map { user ->
                            CareerPyramidItem(
                                userId = user.userId,
                                name = user.name,
                                deactivated = user.deactivated,
                                positions = user.positions.mapIndexed { i, row ->
                                    CareerPyramidPosition(
                                        startDate = row.startDate,
                                        endDate = effectiveEndDate(user.positions, i),
                                        careerPath = row.careerPathId?.let(entries::get),
                                        careerSpecialization = row.careerSpecializationId?.let(entries::get),
                                        seniorityLevel = row.seniorityLevelId?.let(entries::get),
                                    )
                                },
                            )
                        },
                        earliestStartDate = data.earliestStartDate,
                    ),
                )
            }
            get<UserCareerPositions> { route ->
                val caller = call.caller()
                if (userService.read(route.id) == null) {
                    throw NotFoundException("User not found")
                }
                requireCareerPositionRead(caller, route.id) {
                    careerPositionService.managesUser(caller.userId, route.id)
                }
                // The canEdit capability = exactly the write right (the chain walk). Evaluated
                // unconditionally: the read guard short-circuits for self/HR before its own
                // walk, so those paths pay this one extra query — the registered
                // TeamKpiRoutes capability trade-off (backlog #8).
                val canEdit = caller.userId != route.id &&
                    careerPositionService.managesUser(caller.userId, route.id)
                val rows = careerPositionService.listRows(route.id)
                val entries = userService.resolveEntryRefs(
                    *rows.flatMap { listOf(it.careerPathId, it.careerSpecializationId, it.seniorityLevelId) }
                        .toTypedArray(),
                )
                call.respond(HttpStatusCode.OK, CareerPositionList(toResponses(rows, entries), canEdit = canEdit))
            }
            post<UserCareerPositions> { route ->
                val caller = call.caller()
                // Guard before the read and the payload (403 wins over 404/400): a non-manager
                // probe learns nothing, not even whether the user id exists.
                requireCareerPositionWrite(caller) { careerPositionService.managesUser(caller.userId, route.id) }
                if (userService.read(route.id) == null) {
                    throw NotFoundException("User not found")
                }
                // Recording a NEW position is a new assignment — blocked for deactivated users
                // (the requireNoDeactivatedUsers rule; 400 after the guard, so 403 still wins).
                // This also keeps the stored deactivation end unshadowable: no row can ever be
                // appended behind it. Corrections and deletes of history stay allowed.
                userService.requireNoDeactivatedUsers(listOf(route.id))
                val write = call.receive<CareerPositionWrite>()
                validateCareerPositionWrite(write)
                // Every set ref is a fresh assignment on create — all must be active entries.
                userService.requireActiveEntries(changedRefs(write, current = null))
                val (id, notification) = careerPositionService.create(caller.userId, route.id, write)
                call.response.header(
                    HttpHeaders.Location,
                    call.application.href(UserCareerPositions.Position(UserCareerPositions(route.id), id)),
                )
                notificationService.create(notification)
                val auditFields = mutableListOf<Pair<String, Any?>>(
                    "byUserId" to caller.userId.toLong(),
                    "targetUserId" to route.id.toLong(),
                    "positionId" to id.toLong(),
                    "startDate" to write.startDate,
                )
                write.careerPathId?.let { auditFields += "careerPathId" to it.toLong() }
                write.careerSpecializationId?.let { auditFields += "careerSpecializationId" to it.toLong() }
                write.seniorityLevelId?.let { auditFields += "seniorityLevelId" to it.toLong() }
                audit("career_position.created", *auditFields.toTypedArray())
                val row = careerPositionService.readRow(id)
                    .orVanished("Career position", id)
                val entries = userService.resolveEntryRefs(
                    row.careerPathId,
                    row.careerSpecializationId,
                    row.seniorityLevelId,
                )
                // Appended after the latest start, so the new position is always the open one.
                call.respond(HttpStatusCode.Created, toResponses(listOf(row), entries).single())
            }
            put<UserCareerPositions.Position> { route ->
                val existing = writeGuardedPosition(call, route.parent.id, route.positionId)
                val write = call.receive<CareerPositionWrite>()
                validateCareerPositionWrite(write)
                // Changed refs only — resubmitting the row's current (possibly since-soft-deleted)
                // id is not a change; a date-only correction must not trip over a stale ref.
                userService.requireActiveEntries(changedRefs(write, existing))
                if (careerPositionService.update(route.positionId, write) == 0) {
                    throw NotFoundException("Career position not found")
                }
                val auditFields = mutableListOf<Pair<String, Any?>>(
                    "byUserId" to call.caller().userId.toLong(),
                    "targetUserId" to existing.userId.toLong(),
                    "positionId" to route.positionId.toLong(),
                )
                if (write.startDate != existing.startDate) {
                    auditFields += "startDateFrom" to existing.startDate
                    auditFields += "startDateTo" to write.startDate
                }
                // Entry ids, not values (ids are stable under renames); From omitted when the
                // field was previously unset — the user.updated delta shape.
                fun delta(field: String, from: UInt?, to: UInt?) {
                    if (to != from) {
                        from?.let { auditFields += "${field}From" to it.toLong() }
                        to?.let { auditFields += "${field}To" to it.toLong() }
                    }
                }
                delta("careerPath", existing.careerPathId, write.careerPathId)
                delta("careerSpecialization", existing.careerSpecializationId, write.careerSpecializationId)
                delta("seniorityLevel", existing.seniorityLevelId, write.seniorityLevelId)
                audit("career_position.updated", *auditFields.toTypedArray())
                call.respond(HttpStatusCode.NoContent)
            }
            delete<UserCareerPositions.Position> { route ->
                val existing = writeGuardedPosition(call, route.parent.id, route.positionId)
                if (careerPositionService.delete(route.positionId) == 0) {
                    throw NotFoundException("Career position not found")
                }
                audit(
                    "career_position.deleted",
                    "byUserId" to call.caller().userId.toLong(),
                    "targetUserId" to existing.userId.toLong(),
                    "positionId" to route.positionId.toLong(),
                    "startDate" to existing.startDate,
                )
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
