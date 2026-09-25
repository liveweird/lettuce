package ch.nokillswit.notifications

import ch.nokillswit.infra.catchingFailures
import ch.nokillswit.infra.teams.ConversationResult
import ch.nokillswit.infra.teams.ResolveResult
import ch.nokillswit.infra.teams.SendResult
import ch.nokillswit.infra.teams.TeamsMessenger
import ch.nokillswit.users.Feature
import ch.nokillswit.users.User
import ch.nokillswit.users.UserService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.slf4j.LoggerFactory

/**
 * Mirrors freshly minted in-app notifications to the recipients' Microsoft Teams inbox as a
 * direct message (v4.5.0) — the [NotificationEmailer] twin, riding the same
 * [NotificationMirror.dispatch] contract: invoked AFTER the notification transaction commits,
 * one fire-and-forget [scope] launch per batch, sends sequential, each failure only logged (no
 * queue/retry/outbox, matching the mail posture).
 *
 * **Per-recipient skip order,** each check against a fresh [UserService.read] (so a preference
 * change or a flag flip takes effect immediately, no JWT-claim staleness — the email mirror's
 * rule):
 *  1. no [messenger] (`teams.transport=disabled`) → skip everything, silently — Teams is a side
 *     effect here, never the requested feature;
 *  2. recipient soft-deleted or deactivated → skip;
 *  3. [Feature.TEAMS_NOTIFICATIONS] is in the recipient's disabled set → skip, **even for a
 *     [NotificationType.lockedOn] type** — unlike the email mirror's V51 master switch, this flag
 *     means the user has no Teams channel at all, so there is nothing a locked type could ride;
 *  4. for a type that is NOT `lockedOn`: the type's feature is disabled for the recipient, OR the
 *     recipient disabled that type's `TEAMS` channel (v4.0.0-style per-type preferences) → skip;
 *  5. the identity cache's `unreachable_until` is still in the future → skip (an uninstalled bot,
 *     an unknown Graph user, or a blocked conversation isn't retried on every notification);
 *  6. the shared [notificationEmailContent] catalog returns null (the PASSWORD_CHANGED reset
 *     variant, where the reset email itself is the notice) → skip.
 *
 * Text reuses [notificationEmailContent] — subject, a blank line, then the body (which already
 * carries the `mail.appUrl` deep link) — rendered PLAIN TEXT, never markdown, so a party's display
 * name cannot inject Teams-side formatting.
 *
 * **Identity cache** (`user_teams_identities`, `V85`): resolving a Lettuce email to an Entra
 * object id (Microsoft Graph) and creating the 1:1 conversation (Bot Framework connector) are
 * each one extra round trip, so both are cached per user. A stored `email` that no longer matches
 * the recipient's CURRENT canonical email invalidates the whole cached row (re-resolved from
 * scratch — a re-created conversation with the new identity). A cached conversation id that the
 * connector reports gone (404 on send) is dropped and [TeamsMessenger.ensureConversation] is
 * retried exactly once before giving up for this notification. A resolve/send outcome of
 * [ResolveResult.Unreachable]/[ConversationResult.Unreachable]/[SendResult.Unreachable] stamps
 * `unreachable_until` [unreachableRetryMillis] ahead of [clock] — see skip rule 5. [markUnreachable]
 * additionally nulls the cached `aad_object_id`/`conversation_id` unless the caller already knows
 * they are valid for the email being written (`keepAad` — see its call sites): a RESOLVE-stage
 * failure must never let a STALE pair from a previous email survive under a freshly written one,
 * or a later send would go to the wrong person's Teams conversation.
 */
class NotificationTeamsSender(
    private val scope: CoroutineScope,
    private val database: R2dbcDatabase,
    private val messenger: TeamsMessenger?,
    private val appUrl: String?,
    private val userService: UserService,
    private val notificationPreferenceService: NotificationPreferenceService,
    private val unreachableRetryMillis: Long,
    // Injectable for deterministic tests — the LoginThrottle/NotificationService idiom.
    private val clock: () -> Long = System::currentTimeMillis,
) : NotificationMirror {
    object UserTeamsIdentities : Table("user_teams_identities") {
        val userId = reference("user_id", UserService.Users)
        val email = varchar("email", 254)
        val aadObjectId = varchar("aad_object_id", 64).nullable()
        val conversationId = varchar("conversation_id", 512).nullable()
        val unreachableReason = varchar("unreachable_reason", 32).nullable()
        val unreachableUntil = long("unreachable_until").nullable()
        val updatedAt = long("updated_at")
        override val primaryKey = PrimaryKey(userId)
    }

    private data class Identity(
        val email: String,
        val aadObjectId: String?,
        val conversationId: String?,
        val unreachableUntil: Long?,
    )

    private val log = LoggerFactory.getLogger("ch.nokillswit.teams")

    override fun dispatch(notifications: List<Notification>) {
        val messenger = messenger ?: return
        if (notifications.isEmpty()) return
        scope.launch {
            // One batched TEAMS-channel disabled-set read for the whole batch, the email mirror's
            // per-batch (not per-recipient) shape.
            val disabledTeams = notificationPreferenceService.disabledFor(
                notifications.map { it.recipientId }.toSet(),
                NotificationChannel.TEAMS,
            )
            notifications.forEach { notification ->
                // Rethrows CancellationException untouched (the `infra.catchingFailures` idiom,
                // NotificationService.purgeCatchingFailures' sibling) — a plain `catch (e:
                // Exception)` would also swallow the dispatch coroutine's own cancellation.
                catchingFailures({ sendOne(messenger, notification, disabledTeams) }) { e ->
                    log.error(
                        "Teams notification to user {} ({}) failed",
                        notification.recipientId,
                        notification.type,
                        e,
                    )
                }
            }
        }
    }

    // Split into small single-purpose functions rather than one long guard-clause chain — each
    // stays well under the repo's ReturnCount gate, and every step (skip decision, identity
    // resolution, the send-and-retry-once dance) reads as its own named concern.
    private suspend fun sendOne(
        messenger: TeamsMessenger,
        notification: Notification,
        disabledTeams: Map<UInt, Set<NotificationType>>,
    ) {
        val recipientId = notification.recipientId
        val recipient = userService.read(recipientId) ?: return
        if (shouldSkip(recipient, notification, disabledTeams)) return
        // A row whose stored email no longer matches the recipient's CURRENT canonical email
        // belongs to a stale identity — never consulted, not even for the unreachable window.
        val cached = readIdentity(recipientId)?.takeIf { it.email == recipient.email }
        if (cached?.unreachableUntil?.let { it > clock() } == true) return
        val content = notificationEmailContent(
            recipientName = recipient.name,
            type = notification.type,
            params = notification.params,
            link = notification.link,
            appUrl = appUrl,
            language = recipient.language,
        ) ?: return
        deliver(messenger, recipientId, recipient.email, cached, "${content.subject}\n\n${content.body}")
    }

    private fun shouldSkip(
        recipient: User,
        notification: Notification,
        disabledTeams: Map<UInt, Set<NotificationType>>,
    ): Boolean {
        if (recipient.deactivated) return true
        if (Feature.TEAMS_NOTIFICATIONS in recipient.disabledFeatures) return true
        if (notification.type.lockedOn) return false
        if (notification.type.feature?.let { it in recipient.disabledFeatures } == true) return true
        return notification.type in disabledTeams.getOrDefault(notification.recipientId, emptySet())
    }

    /** Resolves (or reuses) the Entra object id and conversation id, then attempts the send. */
    private suspend fun deliver(
        messenger: TeamsMessenger,
        recipientId: UInt,
        email: String,
        cached: Identity?,
        text: String,
    ) {
        val aadObjectId = cached?.aadObjectId ?: resolveAndCache(messenger, recipientId, email) ?: return
        val conversationId = cached?.conversationId
            ?: createAndCacheConversation(messenger, recipientId, email, aadObjectId)
            ?: return
        handleSendResult(messenger.sendMessage(conversationId, text), messenger, recipientId, email, aadObjectId, text)
    }

    private suspend fun handleSendResult(
        result: SendResult,
        messenger: TeamsMessenger,
        recipientId: UInt,
        email: String,
        aadObjectId: String,
        text: String,
    ) {
        when (result) {
            SendResult.Sent, SendResult.Failed -> Unit
            SendResult.ConversationNotFound -> retryAfterConversationGone(messenger, recipientId, email, aadObjectId, text)
            // `aadObjectId` here is the one that just resolved/created this conversation for the
            // CURRENT `email` — still good, so keep it (only the conversation is presumed dead).
            is SendResult.Unreachable -> markUnreachable(recipientId, email, result.reason, keepAad = true)
        }
    }

    /** The documented "drop the stale cached conversation id and recreate ONCE" recovery. */
    private suspend fun retryAfterConversationGone(
        messenger: TeamsMessenger,
        recipientId: UInt,
        email: String,
        aadObjectId: String,
        text: String,
    ) {
        clearConversation(recipientId)
        val freshConversationId = createAndCacheConversation(messenger, recipientId, email, aadObjectId) ?: return
        val retry = messenger.sendMessage(freshConversationId, text)
        if (retry is SendResult.Unreachable) markUnreachable(recipientId, email, retry.reason, keepAad = true)
        // Sent, ConversationNotFound again, or Failed — no further retry.
    }

    private suspend fun resolveAndCache(messenger: TeamsMessenger, userId: UInt, email: String): String? =
        when (val result = messenger.resolveUser(email)) {
            is ResolveResult.Resolved -> {
                storeResolved(userId, email, result.aadObjectId)
                result.aadObjectId
            }
            is ResolveResult.Unreachable -> {
                // The RESOLVE stage itself failed for `email` — there is no aadObjectId that is
                // known-good for it (the identity cache row for this user could still be
                // carrying a STALE aadObjectId/conversationId from a PREVIOUS email — see
                // storeResolved's doc — and this upsert must not let that pair survive under the
                // new email, or a later send would go to the wrong person's conversation).
                markUnreachable(userId, email, result.reason)
                null
            }
            ResolveResult.Failed -> null
        }

    private suspend fun createAndCacheConversation(
        messenger: TeamsMessenger,
        userId: UInt,
        email: String,
        aadObjectId: String,
    ): String? = when (val result = messenger.ensureConversation(aadObjectId)) {
        is ConversationResult.Created -> {
            storeConversation(userId, result.conversationId)
            result.conversationId
        }
        is ConversationResult.Unreachable -> {
            // `aadObjectId` was JUST resolved for `email` above (or is the cached, still-current
            // one) — the CONVERSATION stage is what failed, so keep it.
            markUnreachable(userId, email, result.reason, keepAad = true)
            null
        }
        ConversationResult.Failed -> null
    }

    private suspend fun readIdentity(userId: UInt): Identity? = suspendTransaction(database) {
        UserTeamsIdentities.selectAll()
            .where { UserTeamsIdentities.userId eq userId }
            .map {
                Identity(
                    email = it[UserTeamsIdentities.email],
                    aadObjectId = it[UserTeamsIdentities.aadObjectId],
                    conversationId = it[UserTeamsIdentities.conversationId],
                    unreachableUntil = it[UserTeamsIdentities.unreachableUntil],
                )
            }
            .toList()
            .singleOrNull()
    }

    private suspend fun storeResolved(userId: UInt, email: String, aadObjectId: String) {
        val now = clock()
        suspendTransaction(database) {
            UserTeamsIdentities.upsert(
                onUpdate = {
                    it[UserTeamsIdentities.email] = email
                    it[UserTeamsIdentities.aadObjectId] = aadObjectId
                    // A fresh resolve invalidates whatever conversation was cached for the OLD
                    // identity — a different Entra object id needs a new 1:1 conversation.
                    it[UserTeamsIdentities.conversationId] = null
                    it[UserTeamsIdentities.unreachableReason] = null
                    it[UserTeamsIdentities.unreachableUntil] = null
                    it[UserTeamsIdentities.updatedAt] = now
                },
            ) {
                it[UserTeamsIdentities.userId] = userId
                it[UserTeamsIdentities.email] = email
                it[UserTeamsIdentities.aadObjectId] = aadObjectId
                it[UserTeamsIdentities.conversationId] = null
                it[UserTeamsIdentities.unreachableReason] = null
                it[UserTeamsIdentities.unreachableUntil] = null
                it[UserTeamsIdentities.updatedAt] = now
            }
        }
    }

    private suspend fun storeConversation(userId: UInt, conversationId: String) {
        val now = clock()
        suspendTransaction(database) {
            UserTeamsIdentities.update({ UserTeamsIdentities.userId eq userId }) {
                it[UserTeamsIdentities.conversationId] = conversationId
                // A successful conversation create clears whatever unreachable window a PRIOR
                // failure stamped — this row is reachable again.
                it[UserTeamsIdentities.unreachableReason] = null
                it[UserTeamsIdentities.unreachableUntil] = null
                it[UserTeamsIdentities.updatedAt] = now
            }
        }
    }

    private suspend fun clearConversation(userId: UInt) {
        val now = clock()
        suspendTransaction(database) {
            UserTeamsIdentities.update({ UserTeamsIdentities.userId eq userId }) {
                it[UserTeamsIdentities.conversationId] = null
                it[UserTeamsIdentities.updatedAt] = now
            }
        }
    }

    /**
     * Stamps the unreachable window for [userId]/[email]. [keepAad] must be `true` only when the
     * caller already knows the STORED `aad_object_id` (if any) is valid for THIS [email] — the
     * conversation and send stages, which reached this point only after resolving/reusing that
     * id for the same email in this very call. It defaults to `false` (null both
     * `aad_object_id`/`conversation_id`) for the RESOLVE stage, where the row being written may
     * still be carrying a stale pair left over from a DIFFERENT email — see the call site's doc.
     * Nulling on a plain "not reachable right now" outcome is a deliberate over-null: it costs
     * one extra resolve after the window expires, in exchange for never pairing one person's
     * email with another's Teams identity.
     */
    private suspend fun markUnreachable(userId: UInt, email: String, reason: String, keepAad: Boolean = false) {
        val now = clock()
        val until = now + unreachableRetryMillis
        suspendTransaction(database) {
            UserTeamsIdentities.upsert(
                onUpdate = {
                    it[UserTeamsIdentities.email] = email
                    if (!keepAad) it[UserTeamsIdentities.aadObjectId] = null
                    it[UserTeamsIdentities.conversationId] = null
                    it[UserTeamsIdentities.unreachableReason] = reason
                    it[UserTeamsIdentities.unreachableUntil] = until
                    it[UserTeamsIdentities.updatedAt] = now
                },
            ) {
                it[UserTeamsIdentities.userId] = userId
                it[UserTeamsIdentities.email] = email
                it[UserTeamsIdentities.aadObjectId] = null
                it[UserTeamsIdentities.conversationId] = null
                it[UserTeamsIdentities.unreachableReason] = reason
                it[UserTeamsIdentities.unreachableUntil] = until
                it[UserTeamsIdentities.updatedAt] = now
            }
        }
        log.info("Teams recipient {} unreachable ({}) until {}", userId, reason, until)
    }
}
