package ch.nokillswit.sharing

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/** Where a withdrawn share's SHARER is sent: their own "Shared by me" list. */
internal const val SHARED_BY_ME_LINK = "/shares?tab=byMe"

/** Where a mass share's summary notice sends the sharee: the Shared screen (their "With me" tab). */
internal const val BATCH_SHARED_LINK = "/shares"

/**
 * The notification a new share mints for the SHARE'S RECIPIENT (the sharee): params `{sharer}`
 * plus the raw ISO `expiresOn` when the share has an end date (formatted client-side), link =
 * the document's view path. The succession copy is content-free by decision — it carries
 * `{sharer}` only (the type name already says "succession plan"; nothing about the seat or the
 * end date). Pure and DB-free like every `*Notifications.kt` builder; the route resolves the
 * sharer's name and persists the result.
 */
internal fun shareCreatedNotification(
    type: ShareableResourceType,
    shareeId: UInt,
    sharerName: String,
    expiresOn: String?,
    link: String,
): Notification {
    val params = buildMap {
        put("sharer", sharerName)
        if (expiresOn != null && type != ShareableResourceType.SUCCESSION_PLAN) put("expiresOn", expiresOn)
    }
    return Notification(recipientId = shareeId, type = type.sharedNotification, params = params, link = link)
}

/**
 * The ONE summary notification a mass share (v4.10.0) mints per sharee: params `{sharer, count}`
 * plus the raw ISO `expiresOn` when the batch has an end date (formatted client-side), link = the
 * Shared screen. [count] is the number of shares created for this sharee in the batch. Pure and
 * DB-free; the route resolves the sharer's name, the count and the type via
 * [batchSharedNotification] on the resource type.
 */
internal fun batchSharedNotification(
    type: NotificationType,
    shareeId: UInt,
    sharerName: String,
    count: Int,
    expiresOn: String?,
): Notification {
    val params = buildMap {
        put("sharer", sharerName)
        put("count", count.toString())
        if (expiresOn != null) put("expiresOn", expiresOn)
    }
    return Notification(recipientId = shareeId, type = type, params = params, link = BATCH_SHARED_LINK)
}

/**
 * The notifications a withdrawal mints: always one for the SHARE'S RECIPIENT (params
 * `{sharer, sharee, actor}`, no link — the document is no longer theirs to follow), and, when
 * someone other than the sharer withdrew it (the document's author), a second one for the
 * SHARER carrying `self: "sharer"` (the `PASSWORD_CHANGED` context-carrier idiom) and a link to
 * their "Shared by me" list. The succession copies carry `{sharer}` only (+ the `self` carrier on
 * the sharer's copy) — they name nobody else.
 */
internal fun shareWithdrawnNotifications(
    type: ShareableResourceType,
    sharerId: UInt,
    sharerName: String,
    shareeId: UInt,
    shareeName: String,
    actorId: UInt,
    actorName: String,
): List<Notification> {
    val contentFree = type == ShareableResourceType.SUCCESSION_PLAN
    val shareeParams = if (contentFree) {
        mapOf("sharer" to sharerName)
    } else {
        mapOf("sharer" to sharerName, "sharee" to shareeName, "actor" to actorName)
    }
    val toSharee = Notification(recipientId = shareeId, type = type.withdrawnNotification, params = shareeParams, link = null)
    if (actorId == sharerId) return listOf(toSharee)
    val toSharer = Notification(
        recipientId = sharerId,
        type = type.withdrawnNotification,
        params = shareeParams + ("self" to "sharer"),
        link = SHARED_BY_ME_LINK,
    )
    return listOf(toSharee, toSharer)
}
