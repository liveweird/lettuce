package ch.nokillswit.notifications

import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserService
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.vendors.ForUpdateOption
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val NotificationPreferenceServiceKey = AttributeKey<NotificationPreferenceService>("NotificationPreferenceService")

/**
 * The channels a notification can reach a recipient through: `IN_APP` and `EMAIL` since v4.0.0,
 * joined by `TEAMS` in v4.5.0 (a Microsoft Teams direct message — see
 * `notifications/NotificationTeamsSender.kt`).
 */
@Serializable
enum class NotificationChannel { IN_APP, EMAIL, TEAMS }

/**
 * `true` only for [NotificationType.PASSWORD_CHANGED] — a security receipt that stays on for
 * both channels regardless of what the user's preferences say
 * ([NotificationPreferenceService.replace] rejects any attempt to disable it). The exhaustive
 * `when` (no `else`) is the sibling of [NotificationType.feature] in `Notification.kt`: it forces
 * every future type to make the choice consciously rather than silently inheriting a default.
 */
val NotificationType.lockedOn: Boolean
    get() = when (this) {
        NotificationType.PASSWORD_CHANGED -> true
        NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER,
        NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER,
        NotificationType.FEEDBACK_SENT_TO_SUBJECT,
        NotificationType.FEEDBACK_SENT_TO_PROVIDER,
        NotificationType.FEEDBACK_SENT_TO_REQUESTER,
        NotificationType.FEEDBACK_SENT_TO_MANAGER,
        NotificationType.FEEDBACK_REJECTED_TO_REQUESTER,
        NotificationType.FEEDBACK_PICKED_UP_TO_REQUESTER,
        NotificationType.FEEDBACK_WITHDRAWN_TO_SUBJECT,
        NotificationType.FEEDBACK_WITHDRAWN_TO_REQUESTER,
        NotificationType.FEEDBACK_DELETED_TO_REQUESTER,
        NotificationType.FEEDBACK_REQUEST_EXPIRED_TO_REQUESTER,
        NotificationType.FEEDBACK_REQUEST_EXPIRED_TO_PROVIDER,
        NotificationType.ONE_ON_ONE_CREATED_TO_SUBORDINATE,
        NotificationType.ONE_ON_ONE_CREATED_TO_MANAGER,
        NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE,
        NotificationType.GOAL_DEACTIVATED_TO_SUBORDINATE,
        NotificationType.GOAL_ARCHIVED_TO_SUBORDINATE,
        NotificationType.GOAL_REOPENED_TO_SUBORDINATE,
        NotificationType.GOAL_PROGRESS_UPDATED_TO_SUBORDINATE,
        NotificationType.GOAL_PROGRESS_UPDATED_TO_MANAGER,
        NotificationType.TEAM_KPI_ACTIVATED_TO_MEMBER,
        NotificationType.TEAM_KPI_DEACTIVATED_TO_MEMBER,
        NotificationType.TEAM_KPI_ARCHIVED_TO_MEMBER,
        NotificationType.TEAM_KPI_REOPENED_TO_MEMBER,
        NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER,
        NotificationType.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER,
        NotificationType.TEAM_KPI_VALUE_REMOVED_TO_MEMBER,
        NotificationType.PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE,
        NotificationType.PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE,
        NotificationType.DAYS_OFF_CREATED,
        NotificationType.DAYS_OFF_DELETED,
        NotificationType.DAYS_OFF_CORRECTED_TO_OWNER,
        NotificationType.DAYS_OFF_ALLOWANCE_CHANGED,
        NotificationType.PULSE_CYCLE_SCHEDULED,
        NotificationType.PULSE_CYCLE_OPENED,
        NotificationType.PULSE_RESULTS_AVAILABLE,
        NotificationType.PULSE_CYCLE_CANCELLED,
        NotificationType.IMPACT_ENTRY_CREATED_TO_MANAGER,
        NotificationType.IMPACT_ENTRY_UPDATED_TO_MANAGER,
        NotificationType.IMPACT_ENTRY_DELETED_TO_MANAGER,
        NotificationType.CAREER_POSITION_STARTED_TO_USER,
        -> false
    }

/**
 * Per-user, per-channel notification preferences (v4.0.0, `V84`): stores the DISABLED
 * `(type, channel)` pairs — the `user_disabled_features` shape, so an empty table means every
 * type is on for every channel, exactly the "on by default" requirement.
 *
 * **The open-set rule (v3.25.3) applies here too**: [notification_type] holds the enum's NAME,
 * so a row minted under a type a later build removed or renamed is dropped silently by every
 * reader below rather than blowing up — the same discipline [NotificationService.knownType]
 * applies to the notifications themselves. A release that removes or renames a
 * [NotificationType] owes these preference rows the same same-commit migration as the minted
 * notification rows (translate when a successor exists, delete when none does) — see "Removing
 * or renaming a notification type" in `.claude/docs/features/notifications.md`.
 */
class NotificationPreferenceService(val database: R2dbcDatabase) {
    object UserNotificationPreferences : Table("user_notification_preferences") {
        val userId = reference("user_id", UserService.Users)
        val notificationType = varchar("notification_type", 64)
        val channel = varchar("channel", 10)
        override val primaryKey = PrimaryKey(userId, notificationType, channel)
    }

    /** Every disabled `(type, channel)` pair for [userId], keyed by type. Unknown-name rows dropped. */
    suspend fun read(userId: UInt): Map<NotificationType, Set<NotificationChannel>> =
        suspendTransaction(database) { readDisabledInTransaction(userId) }

    /**
     * Wholesale-replaces [userId]'s disabled set (the `setDisabledFeatures` shape), returning the
     * set that was in place immediately before the write — `null` when the id is unknown or
     * soft-deleted (the route 404s). Rejects a [disabled] set that disables any
     * [NotificationType.lockedOn] type with a 400 — `PASSWORD_CHANGED` cannot be silenced
     * regardless of what the caller submits — before the transaction even opens. Idempotent — a
     * same-set re-PUT is a no-op replace, not a transition.
     *
     * **Concurrency (v4.0.3):** the existence check locks the user row
     * (`SELECT … FOR NO KEY UPDATE` via [ForUpdateOption.PostgreSQL.ForNoKeyUpdate] — never
     * `pg_advisory_xact_lock`, which MFA already keys on the bare user id; a row lock scopes to
     * exactly this contention) and the previous set is read inside that same lock, before the
     * delete/insert. Two concurrent replaces for one user therefore serialize rather than
     * interleave: under plain READ COMMITTED, the second's `DELETE` could not see the first's
     * still-uncommitted `INSERT`s, so disjoint concurrent sets used to persist as their union, and
     * overlapping ones raced a 23505 into a spurious 409 — now the second waits for the first to
     * commit, reads the now-current previous set, and cleanly last-writer-wins.
     */
    suspend fun replace(
        userId: UInt,
        disabled: Set<Pair<NotificationType, NotificationChannel>>,
    ): Set<Pair<NotificationType, NotificationChannel>>? {
        val locked = disabled.firstOrNull { it.first.lockedOn }
        if (locked != null) {
            throw BadRequestException("${locked.first} is always on and cannot be disabled")
        }
        return suspendTransaction(database) {
            val exists = UserService.Users.select(UserService.Users.id)
                .where { (UserService.Users.id eq userId) and (UserService.Users.markedAsDeleted eq false) }
                .forUpdate(ForUpdateOption.PostgreSQL.ForNoKeyUpdate)
                .toList()
                .isNotEmpty()
            if (!exists) return@suspendTransaction null
            val previous = readDisabledInTransaction(userId)
                .flatMap { (type, channels) -> channels.map { channel -> type to channel } }
                .toSet()
            UserNotificationPreferences.deleteWhere { UserNotificationPreferences.userId eq userId }
            disabled.forEach { (type, channel) ->
                UserNotificationPreferences.insert {
                    it[UserNotificationPreferences.userId] = userId
                    it[notificationType] = type.name
                    it[UserNotificationPreferences.channel] = channel.name
                }
            }
            previous
        }
    }

    /**
     * The disabled [NotificationType] set per recipient among [recipientIds], for one [channel] —
     * one `IN` query. Public entry point for callers with no ambient transaction (the mail
     * sender); [NotificationService.create]/[createAll] instead call [disabledForInTransaction]
     * directly from inside their own insert transaction — the `GoalService`/`ImpactLogService`
     * cross-feature table-read shape (see "Cross-feature table reads" in
     * `.claude/docs/persistence.md`): querying [UserNotificationPreferences] straight from
     * another feature's transaction, never through this service's own (which would open a
     * second one and break atomicity).
     */
    suspend fun disabledFor(recipientIds: Collection<UInt>, channel: NotificationChannel): Map<UInt, Set<NotificationType>> {
        if (recipientIds.isEmpty()) return emptyMap()
        return suspendTransaction(database) { disabledForInTransaction(recipientIds, channel) }
    }
}

/** No transaction wrapper of its own — see [NotificationPreferenceService.disabledFor]'s doc. */
internal suspend fun disabledForInTransaction(
    recipientIds: Collection<UInt>,
    channel: NotificationChannel,
): Map<UInt, Set<NotificationType>> {
    if (recipientIds.isEmpty()) return emptyMap()
    val table = NotificationPreferenceService.UserNotificationPreferences
    val known = NotificationType.entries.map { it.name }
    return table.selectAll()
        .where {
            (table.userId inList recipientIds.toSet()) and
                (table.channel eq channel.name) and
                (table.notificationType inList known)
        }
        .map { it[table.userId].value to NotificationType.valueOf(it[table.notificationType]) }
        .toList()
        .groupBy({ it.first }, { it.second })
        .mapValues { it.value.toSet() }
}

private suspend fun readDisabledInTransaction(userId: UInt): Map<NotificationType, Set<NotificationChannel>> {
    val table = NotificationPreferenceService.UserNotificationPreferences
    val knownTypes = NotificationType.entries.map { it.name }
    return table.selectAll()
        .where { (table.userId eq userId) and (table.notificationType inList knownTypes) }
        .toList()
        // The open-set rule (v3.25.3) applies to BOTH stored enum names here: a row minted under
        // a NotificationChannel a later build removed (or, pre-filtered above, a removed
        // NotificationType) is dropped silently rather than throwing IllegalArgumentException —
        // see the class doc.
        .mapNotNull { row ->
            val channel = NotificationChannel.entries.firstOrNull { it.name == row[table.channel] } ?: return@mapNotNull null
            NotificationType.valueOf(row[table.notificationType]) to channel
        }
        .groupBy({ it.first }, { it.second })
        .mapValues { it.value.toSet() }
}

/** One row of `GET /users/{id}/notification-preferences`. */
@Serializable
data class NotificationPreferenceItem(
    val type: NotificationType,
    // Nullable like NotificationType.feature — null (PASSWORD_CHANGED, CAREER_POSITION_STARTED_TO_USER)
    // groups under "Other" client-side, never hidden by a feature flag.
    val feature: Feature?,
    val inApp: Boolean,
    val email: Boolean,
    // v4.5.0: whether a Teams DM is sent for this type. True unless the recipient disabled it —
    // stored and returned even when TEAMS isn't currently AVAILABLE (see
    // NotificationPreferencesResponse.teamsAvailable) so a later-enabled deployment/flag picks up
    // exactly what was saved, the same "data stays real, client hides the group" rule the
    // per-feature `feature` field already follows.
    val teams: Boolean,
    val locked: Boolean,
)

/** Body of `GET /users/{id}/notification-preferences`. */
@Serializable
data class NotificationPreferencesResponse(
    // The V51 master email-mirror opt-out (users.email_notifications_enabled) — rides here too
    // so the SPA's single page can render both the master switch and the per-type matrix.
    val emailEnabled: Boolean,
    // v4.5.0 — the house capability-flag idiom (TeamResponse.canManageKpis, the career timeline's
    // canEdit): true only when THIS deployment has a live Teams transport (TeamsMessengerKey
    // non-null — never disabled/unconfigured) AND the target hasn't disabled
    // Feature.TEAMS_NOTIFICATIONS. The SPA renders the Teams column only when this is true; PUT
    // always accepts TEAMS pairs regardless (see NotificationPreferencesUpdateRequest), so a
    // preference set before the deployment enabled Teams (or while the user had the flag off)
    // takes effect the moment it becomes available.
    val teamsAvailable: Boolean,
    val items: List<NotificationPreferenceItem>,
)

/** One `(type, channel)` pair to disable, in the PUT body. */
@Serializable
data class DisabledNotificationPreference(
    val type: NotificationType,
    val channel: NotificationChannel,
)

/** Body of `PUT /users/{id}/notification-preferences` — a wholesale replace of the disabled set. */
@Serializable
data class NotificationPreferencesUpdateRequest(
    val disabled: List<DisabledNotificationPreference>,
)
