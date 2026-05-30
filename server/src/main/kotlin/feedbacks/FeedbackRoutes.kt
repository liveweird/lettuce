package ch.nokillswit.feedbacks

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
@Resource("/feedbacks")
class Feedbacks {
    @Serializable
    @Resource("{id}")
    class Id(val parent: Feedbacks = Feedbacks(), val id: UInt)
}

fun Application.configureFeedbackRoutes() {
    val feedbackService = attributes[FeedbackServiceKey]

    routing {
        authenticate {
            post<Feedbacks> {
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
                val feedback = feedbackService.read(route.id)
                if (feedback != null) {
                    call.respond(HttpStatusCode.OK, feedback.toResponse(route.id))
                } else {
                    call.respond(HttpStatusCode.NotFound)
                }
            }
            put<Feedbacks.Id> { route ->
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
                feedbackService.delete(route.id)
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
