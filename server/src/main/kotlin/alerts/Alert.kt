package ch.nokillswit.alerts

import ch.nokillswit.infra.paging.PageResponse
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable

/** Request body for create/update. `startsAt`/`endsAt` are epoch millis; null = unbounded. */
@Serializable
data class Alert(
    val title: String,
    val content: String = "",
    val isActive: Boolean = true,
    val startsAt: Long? = null,
    val endsAt: Long? = null,
)

// Column limit (alerts.title varchar(150)) enforced up-front: 400 instead of a DB-level 500.
const val MAX_ALERT_TITLE_LENGTH = 150
const val MAX_ALERT_CONTENT_LENGTH = 5000

/**
 * The single home of the alert payload rules, enforced by the route (the API 400 path) and
 * re-checked by [AlertService] (so direct service callers stay guarded) — one source, no drift.
 */
fun validateAlert(alert: Alert) {
    if (alert.title.isBlank()) throw BadRequestException("Alert title must not be blank")
    if (alert.title.length > MAX_ALERT_TITLE_LENGTH) {
        throw BadRequestException("Alert title must be at most $MAX_ALERT_TITLE_LENGTH characters")
    }
    if (alert.content.isBlank()) throw BadRequestException("Alert content must not be blank")
    if (alert.content.length > MAX_ALERT_CONTENT_LENGTH) {
        throw BadRequestException("Alert content must be at most $MAX_ALERT_CONTENT_LENGTH characters")
    }
    if (alert.startsAt != null && alert.endsAt != null && alert.startsAt >= alert.endsAt) {
        throw BadRequestException("Alert start must be before its end")
    }
}

@Serializable
data class AlertResponse(
    val id: UInt,
    val title: String,
    val content: String,
    val isActive: Boolean,
    val startsAt: Long?,
    val endsAt: Long?,
)

fun Alert.toResponse(id: UInt) = AlertResponse(id, title, content, isActive, startsAt, endsAt)

typealias AlertPageResponse = PageResponse<AlertResponse>

/** What every authenticated user sees on the banner endpoint — only the displayable fields. */
@Serializable
data class VisibleAlert(
    val id: UInt,
    val title: String,
    val content: String,
)

@Serializable
data class VisibleAlertList(
    val items: List<VisibleAlert>,
)
