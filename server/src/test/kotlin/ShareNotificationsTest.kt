package ch.nokillswit

import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.notifications.feature
import ch.nokillswit.notifications.lockedOn
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.sharing.batchSharedLink
import ch.nokillswit.sharing.batchSharedNotification
import ch.nokillswit.sharing.notificationLabelKeys
import ch.nokillswit.sharing.shareCreatedNotification
import ch.nokillswit.sharing.shareWithdrawnNotifications
import ch.nokillswit.users.Feature
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

/** The pure share-notification builders and type mappings (`sharing/ShareNotifications.kt`, `Share.kt`) — no DB. */
class ShareNotificationsTest {

    @Test
    fun `only performance reviews and days-off calendars are batchable and map to their summary type (v4_11_0)`() {
        ShareableResourceType.entries.forEach { type ->
            val expected = when (type) {
                ShareableResourceType.PERFORMANCE_REVIEW -> NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED
                ShareableResourceType.DAYS_OFF_CALENDAR -> NotificationType.DAYS_OFF_CALENDARS_BATCH_SHARED
                else -> null
            }
            assertEquals(expected, type.batchSharedNotification, "$type")
        }
        // The summary notice's link is per kind: reviews keep the Shared screen, calendars open the shared scope.
        assertEquals("/shares", ShareableResourceType.PERFORMANCE_REVIEW.batchSharedLink)
        assertEquals("/days-off?tab=calendar&scope=shared", ShareableResourceType.DAYS_OFF_CALENDAR.batchSharedLink)
        assertEquals(Feature.DAYS_OFF, NotificationType.DAYS_OFF_CALENDARS_BATCH_SHARED.feature)
        assertFalse(NotificationType.DAYS_OFF_CALENDARS_BATCH_SHARED.lockedOn)
        // The summary type follows its feature and is silenceable like every other share notice.
        assertEquals(Feature.PERFORMANCE_REVIEWS, NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED.feature)
        assertFalse(NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED.lockedOn)
    }

    @Test
    fun `the batch summary notice carries exactly sharer and count, plus expiresOn when bound`() {
        val open = batchSharedNotification(
            NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, 7u, "Sia Sharer", 3, null, "/shares",
        )
        assertEquals(7u, open.recipientId)
        assertEquals(NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, open.type)
        assertEquals(mapOf("sharer" to "Sia Sharer", "count" to "3"), open.params)
        assertEquals("/shares", open.link)

        val bound = batchSharedNotification(
            NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, 7u, "Sia Sharer", 1, "2026-12-31", "/shares",
        )
        assertEquals(mapOf("sharer" to "Sia Sharer", "count" to "1", "expiresOn" to "2026-12-31"), bound.params)
        assertNull(ShareableResourceType.GOAL.batchSharedNotification)
    }

    @Test
    fun `only the calendar carries label params into its notices - the seven document kinds stay byte-identical`() {
        ShareableResourceType.entries.forEach { type ->
            val expected = if (type == ShareableResourceType.DAYS_OFF_CALENDAR) setOf("person") else emptySet()
            assertEquals(expected, type.notificationLabelKeys, "$type")
        }
        // Label params and the self carrier offered to a document kind are ignored: params stay {sharer}+expiresOn.
        val goal = shareCreatedNotification(
            ShareableResourceType.GOAL, 7u, "Sia Sharer", "2026-12-31", "/goals/1/view",
            labelParams = mapOf("person" to "Pat Person", "title" to "Secret"), sharerIsSubject = true,
        )
        assertEquals(mapOf("sharer" to "Sia Sharer", "expiresOn" to "2026-12-31"), goal.params)
        val withdrawn = shareWithdrawnNotifications(
            ShareableResourceType.GOAL, 1u, "Sia Sharer", 7u, "Sam Sharee", 2u, "Ada Author",
            labelParams = mapOf("person" to "Pat Person"), sharerIsSubject = true,
        )
        assertEquals(mapOf("sharer" to "Sia Sharer", "sharee" to "Sam Sharee", "actor" to "Ada Author"), withdrawn[0].params)
        assertEquals(
            mapOf("sharer" to "Sia Sharer", "sharee" to "Sam Sharee", "actor" to "Ada Author", "self" to "sharer"),
            withdrawn[1].params,
        )
    }

    @Test
    fun `a calendar share notice carries exactly sharer and person, plus expiresOn and the own carrier`() {
        val link = "/days-off?tab=calendar&scope=shared&user=5"
        val other = shareCreatedNotification(
            ShareableResourceType.DAYS_OFF_CALENDAR, 7u, "Mia Manager", null, link, labelParams = mapOf("person" to "Pat Person"),
        )
        assertEquals(NotificationType.DAYS_OFF_CALENDAR_SHARED, other.type)
        assertEquals(mapOf("sharer" to "Mia Manager", "person" to "Pat Person"), other.params)
        assertEquals(link, other.link)

        val own = shareCreatedNotification(
            ShareableResourceType.DAYS_OFF_CALENDAR, 7u, "Pat Person", "2026-12-31", link,
            labelParams = mapOf("person" to "Pat Person"), sharerIsSubject = true,
        )
        assertEquals(
            mapOf("sharer" to "Pat Person", "person" to "Pat Person", "expiresOn" to "2026-12-31", "self" to "own"),
            own.params,
        )
        // No dates, pools or entry facts ever ride the notice — only the name — even if the snapshot grew.
        val extra = shareCreatedNotification(
            ShareableResourceType.DAYS_OFF_CALENDAR, 7u, "Mia Manager", null, link,
            labelParams = mapOf("person" to "Pat Person", "poolName" to "Vacation"),
        )
        assertEquals(mapOf("sharer" to "Mia Manager", "person" to "Pat Person"), extra.params)
    }

    @Test
    fun `calendar withdrawal copies name the person, the sharee copy has no link and the author copy is flagged sharer`() {
        val bySharer = shareWithdrawnNotifications(
            ShareableResourceType.DAYS_OFF_CALENDAR, 1u, "Mia Manager", 7u, "Sam Sharee", 1u, "Mia Manager",
            labelParams = mapOf("person" to "Pat Person"),
        )
        assertEquals(1, bySharer.size)
        assertEquals(NotificationType.DAYS_OFF_CALENDAR_SHARE_WITHDRAWN, bySharer.single().type)
        assertEquals(
            mapOf("sharer" to "Mia Manager", "sharee" to "Sam Sharee", "actor" to "Mia Manager", "person" to "Pat Person"),
            bySharer.single().params,
        )
        assertNull(bySharer.single().link)

        // The person (the author) withdraws a manager's share: the sharee AND the sharer are told.
        val byAuthor = shareWithdrawnNotifications(
            ShareableResourceType.DAYS_OFF_CALENDAR, 1u, "Mia Manager", 7u, "Sam Sharee", 5u, "Pat Person",
            labelParams = mapOf("person" to "Pat Person"),
        )
        assertEquals(2, byAuthor.size)
        assertEquals("sharer", byAuthor[1].params["self"])
        assertEquals("Pat Person", byAuthor[1].params["person"])

        // The person's own share, withdrawn by the person: the sharee's copy reads "their own calendar".
        val own = shareWithdrawnNotifications(
            ShareableResourceType.DAYS_OFF_CALENDAR, 5u, "Pat Person", 7u, "Sam Sharee", 5u, "Pat Person",
            labelParams = mapOf("person" to "Pat Person"), sharerIsSubject = true,
        )
        assertEquals(1, own.size)
        assertEquals("own", own.single().params["self"])
    }
}
