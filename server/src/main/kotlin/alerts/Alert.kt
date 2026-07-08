package ch.nokillswit.alerts

import ch.nokillswit.infra.paging.PageResponse
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
