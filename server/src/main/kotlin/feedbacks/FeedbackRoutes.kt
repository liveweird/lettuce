package ch.nokillswit.feedbacks

import ch.nokillswit.authz.caller
import ch.nokillswit.authz.canReadFeedback
import ch.nokillswit.authz.requireFeedbackRead
import ch.nokillswit.authz.requireFeedbackWrite
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.notifications.NotificationServiceKey
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.BadRequestException
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
import io.r2dbc.spi.R2dbcException
import org.jetbrains.exposed.v1.exceptions.ExposedSQLException

@Serializable
@Resource("/api/feedbacks")
class Feedbacks {
    @Serializable
    @Resource("{id}")
    class Id(val parent: Feedbacks = Feedbacks(), val id: UInt)
}

fun Application.configureFeedbackRoutes() {
    val feedbackService = attributes[FeedbackServiceKey]
    val notificationService = attributes[NotificationServiceKey]

    routing {
        authenticate {
            get<Feedbacks> {
                val caller = call.caller()
                val params = call.request.queryParameters
                val view = when (val raw = params["view"]?.takeIf { it.isNotBlank() } ?: "received") {
                    "received" -> FeedbackListView.RECEIVED
                    "provided" -> FeedbackListView.PROVIDED
                    "team" -> FeedbackListView.TEAM
                    else -> throw BadRequestException("Unknown view: $raw (allowed: received, provided, team)")
                }
                val paging = call.parsePaging(
                    sortable = setOf("id", "requesterName", "subjectName", "providerName", "visibility", "status", "lastModified"),
                )
                val visibilityFilter = params["visibility"]?.takeIf { it.isNotBlank() }?.let { raw ->
                    runCatching { FeedbackVisibility.valueOf(raw) }.getOrElse {
                        throw BadRequestException(
                            "Unknown visibility: $raw (allowed: ${FeedbackVisibility.entries.joinToString { it.name }})",
                        )
                    }
                }
                val statusFilter = params["status"]?.takeIf { it.isNotBlank() }?.let { raw ->
                    runCatching { FeedbackStatus.valueOf(raw) }.getOrElse {
                        throw BadRequestException(
                            "Unknown status: $raw (allowed: ${FeedbackStatus.entries.joinToString { it.name }})",
                        )
                    }
                }
                val providerIdFilter = params["providerId"]?.takeIf { it.isNotBlank() }?.let { raw ->
                    raw.toUIntOrNull() ?: throw BadRequestException("Invalid providerId: $raw")
                }
                val subjectIdFilter = params["subjectId"]?.takeIf { it.isNotBlank() }?.let { raw ->
                    raw.toUIntOrNull() ?: throw BadRequestException("Invalid subjectId: $raw")
                }
                val lastModifiedGteFilter = params["lastModified[gte]"]?.takeIf { it.isNotBlank() }?.let { raw ->
                    raw.toLongOrNull() ?: throw BadRequestException("Invalid lastModified[gte]: $raw")
                }
                val filter = FeedbackListFilter(
                    requesterName = params["requesterName"]?.takeIf { it.isNotBlank() },
                    subjectName = params["subjectName"]?.takeIf { it.isNotBlank() },
                    providerName = params["providerName"]?.takeIf { it.isNotBlank() },
                    providerId = providerIdFilter,
                    subjectId = subjectIdFilter,
                    visibility = visibilityFilter,
                    status = statusFilter,
                    lastModifiedGte = lastModifiedGteFilter,
                )
                val result = feedbackService.list(view, caller.userId, filter, paging)
                call.respond(
                    HttpStatusCode.OK,
                    FeedbackPageResponse(
                        items = result.items,
                        page = paging.page,
                        pageSize = paging.pageSize,
                        total = result.total,
                    ),
                )
            }
            post<Feedbacks> {
                call.caller()
                val feedback = call.receive<Feedback>()
                val result = try {
                    feedbackService.create(feedback)
                } catch (e: ExposedSQLException) {
                    throw BadRequestException("Referenced user does not exist", e)
                } catch (e: R2dbcException) {
                    throw BadRequestException("Referenced user does not exist", e)
                }
                val id = result.id
                call.response.header(HttpHeaders.Location, call.application.href(Feedbacks.Id(id = id)))
                // Best-effort side effect: deliver creation notifications after the commit.
                result.notifications.forEach { notificationService.create(it) }
                // Re-read so the response carries the server-assigned lastModified.
                val created = feedbackService.read(id) ?: feedback
                call.respond(HttpStatusCode.Created, created.toResponse(id))
            }
            get<Feedbacks.Id> { route ->
                val caller = call.caller()
                val feedback = feedbackService.read(route.id)
                if (feedback == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@get
                }
                // Only hit the DB for the manager check when the cheap rules don't already allow it.
                val managesSubject = !canReadFeedback(caller, feedback) &&
                    feedbackService.managesSubject(caller.userId, feedback.subjectId)
                requireFeedbackRead(caller, feedback, managesSubject)
                call.respond(HttpStatusCode.OK, feedback.toResponse(route.id))
            }
            put<Feedbacks.Id> { route ->
                val caller = call.caller()
                val existing = feedbackService.read(route.id)
                if (existing == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@put
                }
                requireFeedbackWrite(caller, existing)
                val feedback = call.receive<Feedback>()
                val toNotify = try {
                    feedbackService.update(route.id, feedback)
                } catch (e: ExposedSQLException) {
                    throw BadRequestException("Referenced user does not exist", e)
                } catch (e: R2dbcException) {
                    throw BadRequestException("Referenced user does not exist", e)
                }
                // Best-effort side effect: deliver transition notifications after the commit.
                toNotify.forEach { notificationService.create(it) }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Feedbacks.Id> { route ->
                val caller = call.caller()
                val existing = feedbackService.read(route.id)
                if (existing == null) {
                    call.respond(HttpStatusCode.NoContent)
                    return@delete
                }
                requireFeedbackWrite(caller, existing)
                feedbackService.delete(route.id)
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
