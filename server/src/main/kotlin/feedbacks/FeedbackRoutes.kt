package ch.nokillswit.feedbacks

import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireFeedbackRead
import ch.nokillswit.authz.requireFeedbackWrite
import ch.nokillswit.infra.paging.parsePaging
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

    routing {
        authenticate {
            get<Feedbacks> {
                val caller = call.caller()
                val params = call.request.queryParameters
                val view = params["view"]?.takeIf { it.isNotBlank() } ?: "received"
                if (view != "received") {
                    throw BadRequestException("Unknown view: $view (allowed: received)")
                }
                val paging = call.parsePaging(
                    sortable = setOf("id", "requesterName", "providerName", "visibility", "status"),
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
                val filter = FeedbackListFilter(
                    requesterName = params["requesterName"]?.takeIf { it.isNotBlank() },
                    providerName = params["providerName"]?.takeIf { it.isNotBlank() },
                    visibility = visibilityFilter,
                    status = statusFilter,
                )
                val result = feedbackService.listReceived(caller.userId, filter, paging)
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
                val id = try {
                    feedbackService.create(feedback)
                } catch (e: ExposedSQLException) {
                    throw BadRequestException("Referenced user does not exist", e)
                } catch (e: R2dbcException) {
                    throw BadRequestException("Referenced user does not exist", e)
                }
                call.response.header(HttpHeaders.Location, call.application.href(Feedbacks.Id(id = id)))
                call.respond(HttpStatusCode.Created, feedback.toResponse(id))
            }
            get<Feedbacks.Id> { route ->
                val caller = call.caller()
                val feedback = feedbackService.read(route.id)
                if (feedback == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@get
                }
                requireFeedbackRead(caller, feedback)
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
                try {
                    feedbackService.update(route.id, feedback)
                } catch (e: ExposedSQLException) {
                    throw BadRequestException("Referenced user does not exist", e)
                } catch (e: R2dbcException) {
                    throw BadRequestException("Referenced user does not exist", e)
                }
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
