package ch.nokillswit.notifications

import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireNotificationRecipient
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.plugins.respondProblem
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.resources.delete
import io.ktor.server.resources.get
import io.ktor.server.resources.post
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/api/v1/notifications")
class Notifications {
    @Serializable
    @Resource("{id}")
    class Id(val parent: Notifications = Notifications(), val id: UInt) {
        @Serializable
        @Resource("seen")
        class Seen(val parent: Id)

        @Serializable
        @Resource("unseen")
        class Unseen(val parent: Id)
    }

    /** Bulk "mark all as seen" — the literal `seen-all` segment takes precedence over `{id}`. */
    @Serializable
    @Resource("seen-all")
    class SeenAll(val parent: Notifications = Notifications())
}

fun Application.configureNotificationRoutes() {
    val notificationService = attributes[NotificationServiceKey]

    routing {
        authenticate {
            get<Notifications> {
                val caller = call.caller()
                val paging = call.parsePaging(
                    sortable = setOf("id", "timestamp"),
                    defaultSort = listOf(SortField("timestamp", descending = true)),
                )
                val wasSeenFilter = call.request.queryParameters.optionalString("wasSeen")?.let { raw ->
                    raw.toBooleanStrictOrNull() ?: throw BadRequestException("wasSeen must be true or false")
                }
                val result = notificationService.list(
                    recipientId = caller.userId,
                    filter = NotificationListFilter(wasSeen = wasSeenFilter),
                    paging = paging,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            get<Notifications.Id> { route ->
                val caller = call.caller()
                val notification = notificationService.read(route.id)
                if (notification == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Notification not found")
                    return@get
                }
                requireNotificationRecipient(caller, notification.recipientId)
                call.respond(HttpStatusCode.OK, notification)
            }
            post<Notifications.Id.Seen> { route ->
                val caller = call.caller()
                val notification = notificationService.read(route.parent.id)
                if (notification == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Notification not found")
                    return@post
                }
                requireNotificationRecipient(caller, notification.recipientId)
                notificationService.markSeen(route.parent.id)
                call.respond(HttpStatusCode.NoContent)
            }
            post<Notifications.Id.Unseen> { route ->
                val caller = call.caller()
                val notification = notificationService.read(route.parent.id)
                if (notification == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Notification not found")
                    return@post
                }
                requireNotificationRecipient(caller, notification.recipientId)
                notificationService.markUnseen(route.parent.id)
                call.respond(HttpStatusCode.NoContent)
            }
            post<Notifications.SeenAll> {
                // No per-row guard needed: the update is intrinsically scoped to the caller's own rows.
                val caller = call.caller()
                notificationService.markAllSeen(caller.userId)
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Notifications.Id> { route ->
                val caller = call.caller()
                val notification = notificationService.read(route.id)
                if (notification == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Notification not found")
                    return@delete
                }
                requireNotificationRecipient(caller, notification.recipientId)
                notificationService.delete(route.id)
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
