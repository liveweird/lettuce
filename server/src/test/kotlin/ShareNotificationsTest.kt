package ch.nokillswit

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.notifications.feature
import ch.nokillswit.notifications.lockedOn
import ch.nokillswit.sharing.ShareableResource
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
    fun `only performance reviews and days-off calendars are batchable and map to their summary type (v4_11_0, pulse results are not)`() {
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
        assertNull(ShareableResourceType.PULSE_TEAM_RESULTS.batchSharedNotification)
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
    fun `only the calendar and pulse results carry label params into their notices - the seven document kinds stay byte-identical`() {
        ShareableResourceType.entries.forEach { type ->
            val expected = when (type) {
                ShareableResourceType.DAYS_OFF_CALENDAR -> setOf("person")
                ShareableResourceType.PULSE_TEAM_RESULTS -> setOf("team")
                else -> emptySet()
            }
            assertEquals(expected, type.notificationLabelKeys, "$type")
        }
        // Label params offered to a document kind are ignored: params stay {sharer}+expiresOn. (The self carrier is
        // not type-gated here any more — the routes only ever pass sharerIsSubject = true for an adapter whose
        // isSubject hook says so, and only the calendar's does.)
        val goal = shareCreatedNotification(
            ShareableResourceType.GOAL, 7u, "Sia Sharer", "2026-12-31", "/goals/1/view",
            labelParams = mapOf("person" to "Pat Person", "title" to "Secret"),
        )
        assertEquals(mapOf("sharer" to "Sia Sharer", "expiresOn" to "2026-12-31"), goal.params)
        val withdrawn = shareWithdrawnNotifications(
            ShareableResourceType.GOAL, 1u, "Sia Sharer", 7u, "Sam Sharee", 2u, "Ada Author",
            labelParams = mapOf("person" to "Pat Person"),
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

    @Test
    fun `a pulse results notice carries exactly sharer and team, plus expiresOn - never a cycle or any other label`() {
        val link = "/pulse?tab=results&view=shared&team=5"
        val open = shareCreatedNotification(
            ShareableResourceType.PULSE_TEAM_RESULTS, 7u, "Xia Member", null, link,
            labelParams = mapOf("team" to "AAA"),
        )
        assertEquals(NotificationType.PULSE_RESULTS_SHARED, open.type)
        assertEquals(mapOf("sharer" to "Xia Member", "team" to "AAA"), open.params)
        assertEquals(link, open.link)
        assertEquals(Feature.PULSE_SURVEYS, open.type.feature)
        assertFalse(open.type.lockedOn)
        val bound = shareCreatedNotification(
            ShareableResourceType.PULSE_TEAM_RESULTS, 7u, "Xia Member", "2026-12-31", link,
            labelParams = mapOf("team" to "AAA", "cycle" to "9"),
        )
        assertEquals(mapOf("sharer" to "Xia Member", "team" to "AAA", "expiresOn" to "2026-12-31"), bound.params)
        // sharerIsSubject is no longer type-gated here: the routes derive it from the adapter's isSubject hook,
        // which defaults to false and which only the calendar adapter overrides (the test below).
        val unflagged = shareWithdrawnNotifications(
            ShareableResourceType.PULSE_TEAM_RESULTS, 1u, "Xia Member", 7u, "Sam Sharee", 1u, "Xia Member",
            labelParams = mapOf("team" to "AAA"),
        )
        assertNull(unflagged.single().params["self"])
    }

    @Test
    fun `the isSubject adapter hook defaults to false - only a kind whose resource id is a person overrides it`() {
        val stub = object : ShareableResource<Unit, Unit> {
            override val type = ShareableResourceType.PULSE_TEAM_RESULTS
            override suspend fun read(id: UInt) = Unit
            override suspend fun guard(principal: CallerPrincipal, doc: Unit) = Unit
            override suspend fun isAuthor(userId: UInt, doc: Unit) = false
            override suspend fun label(doc: Unit) = emptyMap<String, String>()
            override fun viewPath(id: UInt) = "/x/$id"
        }
        assertFalse(stub.isSubject(5u, 5u))
    }

    @Test
    fun `pulse results withdrawal copies name the team, the sharee copy has no link and the author copy is flagged sharer`() {
        val bySharer = shareWithdrawnNotifications(
            ShareableResourceType.PULSE_TEAM_RESULTS, 1u, "Xia Member", 7u, "Sam Sharee", 1u, "Xia Member",
            labelParams = mapOf("team" to "AAA"),
        )
        assertEquals(1, bySharer.size)
        assertEquals(NotificationType.PULSE_RESULTS_SHARE_WITHDRAWN, bySharer.single().type)
        assertEquals(
            mapOf("sharer" to "Xia Member", "sharee" to "Sam Sharee", "actor" to "Xia Member", "team" to "AAA"),
            bySharer.single().params,
        )
        assertNull(bySharer.single().link)
        val byAuthor = shareWithdrawnNotifications(
            ShareableResourceType.PULSE_TEAM_RESULTS, 1u, "Xia Member", 7u, "Sam Sharee", 5u, "Mia Manager",
            labelParams = mapOf("team" to "AAA"),
        )
        assertEquals(2, byAuthor.size)
        assertEquals("sharer", byAuthor[1].params["self"])
        assertEquals("AAA", byAuthor[1].params["team"])
    }
}
