package ch.nokillswit

import ch.nokillswit.infra.teams.ConversationResult
import ch.nokillswit.infra.teams.ResolveResult
import ch.nokillswit.infra.teams.SendResult
import ch.nokillswit.infra.teams.TeamsMessenger
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationChannel
import ch.nokillswit.notifications.NotificationTeamsSender
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.users.Feature
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private const val ONE_DAY_MILLIS = 24L * 60 * 60 * 1000

/**
 * The Teams DM mirror (`notifications/NotificationTeamsSender.kt`, v4.5.0) — the
 * `NotificationEmailDeliveryTest` twin, with a fake [TeamsMessenger] standing in for the Bot
 * Framework connector/Microsoft Graph (the real transport is contract-tested against an
 * in-process fake HTTP server in `BotFrameworkTeamsMessengerTest`). Deterministic via a joined
 * `coroutineScope` — the fire-and-forget dispatch launch completes before assertions run.
 */
class NotificationTeamsDeliveryTest {

    private class FakeTeamsMessenger(
        var resolveResult: ResolveResult = ResolveResult.Resolved("aad-object-id"),
        var ensureConversationResult: ConversationResult = ConversationResult.Created("conversation-id"),
        // The default outcome for every sendMessage call; queuedSendResults lets a test script a
        // ONE-TIME result (e.g. a single ConversationNotFound) before falling back to this.
        var sendResult: SendResult = SendResult.Sent,
    ) : TeamsMessenger {
        val resolveCalls = mutableListOf<String>()
        val ensureConversationCalls = mutableListOf<String>()
        val sendCalls = mutableListOf<Pair<String, String>>()
        private val queuedSendResults = ArrayDeque<SendResult>()

        fun queueSendResult(result: SendResult) {
            queuedSendResults.addLast(result)
        }

        override suspend fun resolveUser(email: String): ResolveResult {
            resolveCalls += email
            return resolveResult
        }

        override suspend fun ensureConversation(aadObjectId: String): ConversationResult {
            ensureConversationCalls += aadObjectId
            return ensureConversationResult
        }

        override suspend fun sendMessage(conversationId: String, text: String): SendResult {
            sendCalls += conversationId to text
            return if (queuedSendResults.isNotEmpty()) queuedSendResults.removeFirst() else sendResult
        }
    }

    private fun sentNote(recipientId: UInt) = Notification(
        recipientId = recipientId,
        type = NotificationType.FEEDBACK_SENT_TO_SUBJECT,
        params = mapOf("provider" to "Pat Provider", "subject" to "Sam Subject"),
        link = "/feedback/7/view",
    )

    private fun sender(
        messenger: TeamsMessenger,
        scope: CoroutineScope,
        unreachableRetryMillis: Long = ONE_DAY_MILLIS,
        clock: () -> Long = System::currentTimeMillis,
    ) = NotificationTeamsSender(
        scope = scope,
        database = TestServices.database,
        messenger = messenger,
        appUrl = null,
        userService = TestServices.users,
        notificationPreferenceService = TestServices.notificationPreferences,
        unreachableRetryMillis = unreachableRetryMillis,
        clock = clock,
    )

    /** New seed users default to TEAMS_NOTIFICATIONS DISABLED (the MFA-style inverted default) —
     *  every test that expects delivery must switch it on first, the same way an admin would. */
    private suspend fun freshRecipient(prefix: String, extraDisabled: Set<Feature> = emptySet()): UInt {
        val id = TestUsers.seed(email = uniqueEmail(prefix), password = "pw", roles = emptySet())
        assertEquals(1, TestServices.users.setDisabledFeatures(id, extraDisabled))
        return id
    }

    @Test
    fun `an enabled recipient receives the message as subject blank-line body`(): Unit = runBlocking {
        val userId = freshRecipient("teams-ok")
        val fake = FakeTeamsMessenger()
        coroutineScope {
            TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
        }
        assertEquals(1, fake.sendCalls.size)
        val (conversationId, text) = fake.sendCalls.single()
        assertEquals("conversation-id", conversationId)
        assertTrue(text.startsWith("Lettuce: feedback update\n\n"))
        assertTrue("Feedback from Pat Provider about Sam Subject has been sent." in text)
    }

    @Test
    fun `TEAMS_NOTIFICATIONS disabled skips everything, even a locked type`(): Unit = runBlocking {
        // freshRecipient with no override leaves the inverted default (disabled) in place.
        val userId = TestUsers.seed(email = uniqueEmail("teams-flag-off"), password = "pw", roles = emptySet())
        val fake = FakeTeamsMessenger()
        coroutineScope {
            val service = TestNotifications.withTeamsSender(sender(fake, this))
            service.create(sentNote(userId))
            service.create(Notification(recipientId = userId, type = NotificationType.PASSWORD_CHANGED))
        }
        assertEquals(0, fake.resolveCalls.size, "no resolve should be attempted while the flag is off")
        assertEquals(0, fake.sendCalls.size)
    }

    @Test
    fun `a locked type bypasses the per-type feature and channel disable, but not TEAMS_NOTIFICATIONS`(): Unit =
        runBlocking {
            val userId = freshRecipient("teams-locked", extraDisabled = setOf(Feature.FEEDBACKS))
            // Disable the TEAMS channel specifically for FEEDBACK_SENT_TO_SUBJECT.
            TestServices.notificationPreferences.replace(
                userId,
                setOf(NotificationType.FEEDBACK_SENT_TO_SUBJECT to NotificationChannel.TEAMS),
            )
            val fake = FakeTeamsMessenger()
            coroutineScope {
                val service = TestNotifications.withTeamsSender(sender(fake, this))
                // Feature disabled AND channel disabled -> skipped.
                service.create(sentNote(userId))
                // Locked -> sent regardless of the feature/channel state above.
                service.create(Notification(recipientId = userId, type = NotificationType.PASSWORD_CHANGED))
            }
            assertEquals(1, fake.sendCalls.size)
            assertTrue("Your password was changed." in fake.sendCalls.single().second)
        }

    @Test
    fun `a disabled feature skips a non-locked type`(): Unit = runBlocking {
        val userId = freshRecipient("teams-feature-off", extraDisabled = setOf(Feature.FEEDBACKS))
        val fake = FakeTeamsMessenger()
        coroutineScope {
            TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
        }
        assertEquals(0, fake.sendCalls.size)
    }

    @Test
    fun `a disabled TEAMS channel for the type skips it while the feature stays enabled`(): Unit = runBlocking {
        val userId = freshRecipient("teams-channel-off")
        TestServices.notificationPreferences.replace(
            userId,
            setOf(NotificationType.FEEDBACK_SENT_TO_SUBJECT to NotificationChannel.TEAMS),
        )
        val fake = FakeTeamsMessenger()
        coroutineScope {
            TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
        }
        assertEquals(0, fake.sendCalls.size)
    }

    @Test
    fun `an unreachable resolve is cached and skips the recipient until the window expires`(): Unit = runBlocking {
        val userId = freshRecipient("teams-unreachable")
        var now = System.currentTimeMillis()
        val fake = FakeTeamsMessenger(resolveResult = ResolveResult.Unreachable("user_not_found"))
        coroutineScope {
            TestNotifications.withTeamsSender(sender(fake, this, unreachableRetryMillis = ONE_DAY_MILLIS) { now })
                .create(sentNote(userId))
        }
        assertEquals(1, fake.resolveCalls.size)

        // Still inside the window: no second resolve attempt.
        coroutineScope {
            TestNotifications.withTeamsSender(sender(fake, this, unreachableRetryMillis = ONE_DAY_MILLIS) { now })
                .create(sentNote(userId))
        }
        assertEquals(1, fake.resolveCalls.size, "the unreachable window must suppress a retry")

        // Past the window: the recipient is retried.
        now += ONE_DAY_MILLIS + 1
        fake.resolveResult = ResolveResult.Resolved("aad-object-id")
        coroutineScope {
            TestNotifications.withTeamsSender(sender(fake, this, unreachableRetryMillis = ONE_DAY_MILLIS) { now })
                .create(sentNote(userId))
        }
        assertEquals(2, fake.resolveCalls.size, "past the window, the recipient is resolved again")
        assertEquals(1, fake.sendCalls.size)
    }

    @Test
    fun `a resolved identity and conversation are cached - no second resolve or conversation create`(): Unit =
        runBlocking {
            val userId = freshRecipient("teams-cache")
            val fake = FakeTeamsMessenger()
            // Each create()'s dispatch is fire-and-forget (a `scope.launch {}`, per
            // NotificationMirror) — two creates in ONE coroutineScope would race each other's
            // identity resolution instead of proving cache reuse. A separate coroutineScope per
            // create joins the first dispatch to completion (and its DB write) before the second
            // begins, the same isolation the email-change test below already uses.
            coroutineScope {
                TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
            }
            coroutineScope {
                TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
            }
            assertEquals(1, fake.resolveCalls.size, "the second send must reuse the cached Entra object id")
            assertEquals(1, fake.ensureConversationCalls.size, "the second send must reuse the cached conversation id")
            assertEquals(2, fake.sendCalls.size)
        }

    @Test
    fun `a changed canonical email invalidates the cached identity and re-resolves`(): Unit = runBlocking {
        val userId = freshRecipient("teams-email-change")
        val fake = FakeTeamsMessenger()
        coroutineScope {
            TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
        }
        assertEquals(1, fake.resolveCalls.size)

        val newEmail = uniqueEmail("teams-email-changed")
        val existing = checkNotNull(TestServices.users.read(userId))
        assertEquals(1, TestServices.users.update(userId, existing.copy(email = newEmail)))

        coroutineScope {
            TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
        }
        assertEquals(2, fake.resolveCalls.size, "a changed email must invalidate the cached row and re-resolve")
        assertEquals(newEmail, fake.resolveCalls.last())
    }

    @Test
    fun `an email change followed by an unreachable resolve never pairs the new email with the old identity`(): Unit =
        runBlocking {
            // Checkup review fix: markUnreachable used to leave aad_object_id/conversation_id
            // untouched, so once the unreachable window expired the row's STALE ids (from the
            // person who used to hold this email) would be reused for the NEW person instead of
            // re-resolving — sending their notification to the wrong Teams conversation.
            val userId = freshRecipient("teams-email-then-unreachable")
            val fake = FakeTeamsMessenger(
                resolveResult = ResolveResult.Resolved("aad-old-person"),
                ensureConversationResult = ConversationResult.Created("conversation-old-person"),
            )
            coroutineScope {
                TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
            }
            assertEquals("conversation-old-person", fake.sendCalls.single().first)

            // The email changes to a NEW person's address (a re-assigned mailbox, or a typo fix
            // that now points at someone else) — the row's cached ids still belong to whoever
            // held the OLD email.
            val newEmail = uniqueEmail("teams-new-person")
            val existing = checkNotNull(TestServices.users.read(userId))
            assertEquals(1, TestServices.users.update(userId, existing.copy(email = newEmail)))

            // The new email cannot be resolved YET (e.g. Graph hasn't indexed it): resolveUser
            // returns Unreachable. Before the fix, markUnreachable's upsert would keep
            // "aad-old-person"/"conversation-old-person" paired with the newly written email.
            var now = System.currentTimeMillis()
            fake.resolveResult = ResolveResult.Unreachable("user_not_found")
            coroutineScope {
                TestNotifications.withTeamsSender(sender(fake, this, unreachableRetryMillis = ONE_DAY_MILLIS) { now })
                    .create(sentNote(userId))
            }
            assertEquals(1, fake.sendCalls.size, "still just the one send from before the email change")

            // Past the unreachable window, the new email resolves to its OWN (different) identity.
            now += ONE_DAY_MILLIS + 1
            fake.resolveResult = ResolveResult.Resolved("aad-new-person")
            fake.ensureConversationResult = ConversationResult.Created("conversation-new-person")
            coroutineScope {
                TestNotifications.withTeamsSender(sender(fake, this, unreachableRetryMillis = ONE_DAY_MILLIS) { now })
                    .create(sentNote(userId))
            }
            assertEquals(2, fake.sendCalls.size)
            assertEquals(
                "conversation-new-person",
                fake.sendCalls.last().first,
                "the fixed row must be re-resolved for the new email, never reuse the old person's conversation",
            )
            assertEquals(newEmail, fake.resolveCalls.last(), "the re-resolve must use the CURRENT canonical email")
        }

    @Test
    fun `an unreachable outcome logs an INFO line naming the Lettuce user id`(): Unit = runBlocking {
        val userId = freshRecipient("teams-unreachable-log")
        val fake = FakeTeamsMessenger(resolveResult = ResolveResult.Unreachable("user_not_found"))
        val log = LogCapture("ch.nokillswit.teams")
        try {
            coroutineScope {
                TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
            }
            val event = log.events.firstOrNull {
                "unreachable" in it.formattedMessage && userId.toString() in it.formattedMessage
            }
            assertNotNull(event, "expected an INFO log naming the Lettuce user id, got: ${log.events.map { it.formattedMessage }}")
        } finally {
            log.detach()
        }
    }

    @Test
    fun `a conversation the connector reports gone is recreated once and the send retried`(): Unit = runBlocking {
        val userId = freshRecipient("teams-conv-gone")
        val fake = FakeTeamsMessenger()
        coroutineScope {
            TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
        }
        assertEquals(1, fake.sendCalls.size)

        // The cached conversation id is now stale server-side — the NEXT sendMessage call (the
        // one against the still-cached old id) reports it gone; the retry against the freshly
        // recreated conversation succeeds (the default sendResult, Sent).
        fake.queueSendResult(SendResult.ConversationNotFound)
        fake.ensureConversationResult = ConversationResult.Created("conversation-id-2")
        coroutineScope {
            TestNotifications.withTeamsSender(sender(fake, this)).create(sentNote(userId))
        }
        assertEquals(2, fake.ensureConversationCalls.size, "the stale conversation id is dropped and recreated once")
        assertEquals(3, fake.sendCalls.size, "one send from the first notification, two from the retried one")
        assertEquals("conversation-id", fake.sendCalls[1].first, "the second send still tries the cached (stale) id first")
        assertEquals("conversation-id-2", fake.sendCalls[2].first, "the retry uses the freshly recreated conversation id")
    }

    @Test
    fun `deactivated and soft-deleted recipients are skipped`(): Unit = runBlocking {
        val deactivatedId = freshRecipient("teams-deact")
        val deletedId = freshRecipient("teams-softdel")
        assertEquals(1, TestServices.users.setDeactivated(deactivatedId, true))
        assertEquals(1, TestServices.users.delete(deletedId))
        val fake = FakeTeamsMessenger()
        coroutineScope {
            val service = TestNotifications.withTeamsSender(sender(fake, this))
            service.create(sentNote(deactivatedId))
            service.create(sentNote(deletedId))
        }
        assertEquals(0, fake.sendCalls.size)
    }

    @Test
    fun `no messenger configured (transport disabled) sends nothing`(): Unit = runBlocking {
        val userId = freshRecipient("teams-no-messenger")
        coroutineScope {
            // Build the sender with a null messenger directly — dispatch() must no-op.
            val service = ch.nokillswit.notifications.NotificationService(
                TestServices.database,
                listOf(
                    NotificationTeamsSender(
                        scope = this,
                        database = TestServices.database,
                        messenger = null,
                        appUrl = null,
                        userService = TestServices.users,
                        notificationPreferenceService = TestServices.notificationPreferences,
                        unreachableRetryMillis = ONE_DAY_MILLIS,
                    ),
                ),
            )
            service.create(sentNote(userId))
        }
    }
}
