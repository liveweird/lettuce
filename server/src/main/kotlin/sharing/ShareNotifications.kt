package ch.nokillswit.sharing

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/** Where a withdrawn share's SHARER is sent: their own "Shared by me" list. */
internal const val SHARED_BY_ME_LINK = "/shares?tab=byMe"

/** Where a mass share's summary notice sends the sharee by default: the Shared screen (their "With me" tab). */
internal const val BATCH_SHARED_LINK = "/shares"

/**
 * The `self` carrier value on a calendar share notice (v4.11.0) when the SHARER is the calendar's own
 * person ("shared THEIR days-off calendar"); the `person` param is still present. Absent otherwise.
 */
internal const val SELF_OWN = "own"

/**
 * The `self: "own"` carrier of a sharee-facing notice: present only for the days-off CALENDAR (the one
 * kind whose subject is a person who can also be the sharer) when the sharer IS that person; every
 * other kind ignores [sharerIsSubject] (pulse results name a team, never a person). One definition
 * for the create and the withdraw builders.
 */
private fun ownCarrier(type: ShareableResourceType, sharerIsSubject: Boolean): Map<String, String> =
    if (type == ShareableResourceType.DAYS_OFF_CALENDAR && sharerIsSubject) {
        mapOf("self" to SELF_OWN)
    } else {
        emptyMap()
    }

/**
 * The notification a new share mints for the SHARE'S RECIPIENT (the sharee): params `{sharer}`
 * plus the raw ISO `expiresOn` when the share has an end date (formatted client-side), link =
 * the document's view path. The succession copy is content-free by decision — it carries
 * `{sharer}` only (the type name already says "succession plan"; nothing about the seat or the
 * end date). A kind with [notificationLabelKeys] (the days-off calendar, v4.11.0: `person`; pulse
 * results, v4.12.0: `team`) additionally carries those adapter-label entries from [labelParams] — the
 * plaintext display name — plus, for the calendar only, `self: "own"` when [sharerIsSubject]; the seven
 * document kinds carry none, so their params stay byte-identical. Pure and DB-free like every
 * `*Notifications.kt` builder; the route resolves the sharer's name and persists the result.
 */
internal fun shareCreatedNotification(
    type: ShareableResourceType,
    shareeId: UInt,
    sharerName: String,
    expiresOn: String?,
    link: String,
    labelParams: Map<String, String> = emptyMap(),
    sharerIsSubject: Boolean = false,
): Notification {
    val params = buildMap {
        put("sharer", sharerName)
        putAll(labelParams.filterKeys { it in type.notificationLabelKeys })
        putAll(ownCarrier(type, sharerIsSubject))
        if (expiresOn != null && type != ShareableResourceType.SUCCESSION_PLAN) put("expiresOn", expiresOn)
    }
    return Notification(recipientId = shareeId, type = type.sharedNotification, params = params, link = link)
}

/**
 * The ONE summary notification a mass share (v4.10.0) mints per sharee: params `{sharer, count}`
 * plus the raw ISO `expiresOn` when the batch has an end date (formatted client-side), link = the
 * Shared screen. [count] is the number of shares created for this sharee in the batch. Pure and
 * DB-free; the route resolves the sharer's name, the count, the type via
 * [batchSharedNotification] and the [link] via [batchSharedLink] on the resource type.
 */
internal fun batchSharedNotification(
    type: NotificationType,
    shareeId: UInt,
    sharerName: String,
    count: Int,
    expiresOn: String?,
    link: String,
): Notification {
    val params = buildMap {
        put("sharer", sharerName)
        put("count", count.toString())
        if (expiresOn != null) put("expiresOn", expiresOn)
    }
    return Notification(recipientId = shareeId, type = type, params = params, link = link)
}

/**
 * The notifications a withdrawal mints: always one for the SHARE'S RECIPIENT (params
 * `{sharer, sharee, actor}`, no link — the document is no longer theirs to follow), and, when
 * someone other than the sharer withdrew it (the document's author), a second one for the
 * SHARER carrying `self: "sharer"` (the `PASSWORD_CHANGED` context-carrier idiom) and a link to
 * their "Shared by me" list. The succession copies carry `{sharer}` only (+ the `self` carrier on
 * the sharer's copy) — they name nobody else. A kind with [notificationLabelKeys] (the days-off
 * calendar, v4.11.0; pulse results, v4.12.0) adds those entries of [labelParams] (the creation-time
 * `details` snapshot) to BOTH copies and, for the calendar only, `self: "own"` on the sharee's copy
 * when [sharerIsSubject] (the sharer's copy only
 * exists when the sharer is not the author, and the author of a calendar is its person — so there
 * `sharerIsSubject` is never true and `self` stays `"sharer"`).
 */
internal fun shareWithdrawnNotifications(
    type: ShareableResourceType,
    sharerId: UInt,
    sharerName: String,
    shareeId: UInt,
    shareeName: String,
    actorId: UInt,
    actorName: String,
    labelParams: Map<String, String> = emptyMap(),
    sharerIsSubject: Boolean = false,
): List<Notification> {
    val contentFree = type == ShareableResourceType.SUCCESSION_PLAN
    val labelled = labelParams.filterKeys { it in type.notificationLabelKeys }
    val base = if (contentFree) {
        mapOf("sharer" to sharerName)
    } else {
        mapOf("sharer" to sharerName, "sharee" to shareeName, "actor" to actorName)
    }
    val shareeParams = base + labelled + ownCarrier(type, sharerIsSubject)
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
