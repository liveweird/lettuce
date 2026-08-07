package ch.nokillswit.notifications

import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireNotificationRecipient
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.plugins.respondProblem
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
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
                val wasSeenFilter = call.request.queryParameters.optionalBoolean("wasSeen")
                // Feature-flag exclusion (V46): claim-sourced like route gating — same ≤15-min
                // staleness, no extra read. Only the list is filtered; direct-id operations
                // (GET/{id}, seen/unseen, seen-all, DELETE) deliberately are not.
                val result = notificationService.list(
                    recipientId = caller.userId,
                    filter = NotificationListFilter(
                        wasSeen = wasSeenFilter,
                        disabledFeatures = caller.disabledFeatures,
                    ),
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
                if (notificationService.markSeen(route.parent.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Notification not found")
                } else {
                    call.respond(HttpStatusCode.NoContent)
                }
            }
            post<Notifications.Id.Unseen> { route ->
                val caller = call.caller()
                val notification = notificationService.read(route.parent.id)
                if (notification == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Notification not found")
                    return@post
                }
                requireNotificationRecipient(caller, notification.recipientId)
                if (notificationService.markUnseen(route.parent.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Notification not found")
                } else {
                    call.respond(HttpStatusCode.NoContent)
                }
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
                if (notificationService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Notification not found")
                } else {
                    call.respond(HttpStatusCode.NoContent)
                }
            }
        }
    }
}
