package ch.nokillswit.notifications

import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireNotificationRecipient
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.parsePaging
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
@Resource("/api/notifications")
class Notifications {
    @Serializable
    @Resource("{id}")
    class Id(val parent: Notifications = Notifications(), val id: UInt) {
        @Serializable
        @Resource("seen")
        class Seen(val parent: Id)
    }
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
                val wasSeenFilter = call.request.queryParameters["wasSeen"]?.takeIf { it.isNotBlank() }?.let { raw ->
                    raw.toBooleanStrictOrNull() ?: throw BadRequestException("wasSeen must be true or false")
                }
                val result = notificationService.list(
                    recipientId = caller.userId,
                    filter = NotificationListFilter(wasSeen = wasSeenFilter),
                    paging = paging,
                )
                call.respond(
                    HttpStatusCode.OK,
                    NotificationPageResponse(
                        items = result.items,
                        page = paging.page,
                        pageSize = paging.pageSize,
                        total = result.total,
                    ),
                )
            }
            get<Notifications.Id> { route ->
                val caller = call.caller()
                val notification = notificationService.read(route.id)
                if (notification == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@get
                }
                requireNotificationRecipient(caller, notification.recipientId)
                call.respond(HttpStatusCode.OK, notification)
            }
            post<Notifications.Id.Seen> { route ->
                val caller = call.caller()
                val notification = notificationService.read(route.parent.id)
                if (notification == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@post
                }
                requireNotificationRecipient(caller, notification.recipientId)
                notificationService.markSeen(route.parent.id)
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Notifications.Id> { route ->
                val caller = call.caller()
                val notification = notificationService.read(route.id)
                if (notification == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@delete
                }
                requireNotificationRecipient(caller, notification.recipientId)
                notificationService.delete(route.id)
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
