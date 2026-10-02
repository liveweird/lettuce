package ch.nokillswit.sharing

import ch.nokillswit.infra.paging.PageResponse
import ch.nokillswit.infra.parseIsoDateStrict
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.users.Feature
import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import kotlinx.serialization.Serializable

/**
 * The document kinds that can be shared read-only (v4.8.0). The enum NAME is what
 * `document_shares.resource_type` stores (no CHECK — the V27/V46 idiom, the enum is the
 * whitelist). Days-off entries are deliberately absent (no per-entry view screen yet — a
 * point-release follow-up); pulse surveys are out of scope. Each type owns one feature flag
 * ([feature], gating the sharer's AND the sharee's use of it) and one notification pair
 * ([sharedNotification]/[withdrawnNotification] — exhaustive `when`s, so a new type must pick).
 */
@Serializable
enum class ShareableResourceType {
    FEEDBACK,
    ONE_ON_ONE,
    GOAL,
    TEAM_KPI,
    PERFORMANCE_REVIEW,
    IMPACT_LOG_ENTRY,
    SUCCESSION_PLAN,
}

val ShareableResourceType.feature: Feature
    get() = when (this) {
        ShareableResourceType.FEEDBACK -> Feature.FEEDBACKS
        ShareableResourceType.ONE_ON_ONE -> Feature.ONE_ON_ONES
        ShareableResourceType.GOAL -> Feature.GOALS
        ShareableResourceType.TEAM_KPI -> Feature.TEAM_KPIS
        ShareableResourceType.PERFORMANCE_REVIEW -> Feature.PERFORMANCE_REVIEWS
        ShareableResourceType.IMPACT_LOG_ENTRY -> Feature.IMPACT_LOG
        ShareableResourceType.SUCCESSION_PLAN -> Feature.SUCCESSION_PLANS
    }

/** The notification minted for the sharee when a share of this kind of document starts. */
val ShareableResourceType.sharedNotification: NotificationType
    get() = when (this) {
        ShareableResourceType.FEEDBACK -> NotificationType.FEEDBACK_SHARED
        ShareableResourceType.ONE_ON_ONE -> NotificationType.ONE_ON_ONE_SHARED
        ShareableResourceType.GOAL -> NotificationType.GOAL_SHARED
        ShareableResourceType.TEAM_KPI -> NotificationType.TEAM_KPI_SHARED
        ShareableResourceType.PERFORMANCE_REVIEW -> NotificationType.PERFORMANCE_REVIEW_SHARED
        ShareableResourceType.IMPACT_LOG_ENTRY -> NotificationType.IMPACT_ENTRY_SHARED
        ShareableResourceType.SUCCESSION_PLAN -> NotificationType.SUCCESSION_PLAN_SHARED
    }

/** The notification minted when a share of this kind of document is withdrawn. */
val ShareableResourceType.withdrawnNotification: NotificationType
    get() = when (this) {
        ShareableResourceType.FEEDBACK -> NotificationType.FEEDBACK_SHARE_WITHDRAWN
        ShareableResourceType.ONE_ON_ONE -> NotificationType.ONE_ON_ONE_SHARE_WITHDRAWN
        ShareableResourceType.GOAL -> NotificationType.GOAL_SHARE_WITHDRAWN
        ShareableResourceType.TEAM_KPI -> NotificationType.TEAM_KPI_SHARE_WITHDRAWN
        ShareableResourceType.PERFORMANCE_REVIEW -> NotificationType.PERFORMANCE_REVIEW_SHARE_WITHDRAWN
        ShareableResourceType.IMPACT_LOG_ENTRY -> NotificationType.IMPACT_ENTRY_SHARE_WITHDRAWN
        ShareableResourceType.SUCCESSION_PLAN -> NotificationType.SUCCESSION_PLAN_SHARE_WITHDRAWN
    }

/**
 * The summary notification a mass share (v4.10.0) mints ONCE per sharee per batch, or null when the
 * kind is not batchable (only performance reviews are in v4.10.0). Exhaustive `when`, so a future
 * batchable kind must pick its type.
 */
val ShareableResourceType.batchSharedNotification: NotificationType?
    get() = when (this) {
        ShareableResourceType.PERFORMANCE_REVIEW -> NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED
        ShareableResourceType.FEEDBACK,
        ShareableResourceType.ONE_ON_ONE,
        ShareableResourceType.GOAL,
        ShareableResourceType.TEAM_KPI,
        ShareableResourceType.IMPACT_LOG_ENTRY,
        ShareableResourceType.SUCCESSION_PLAN,
        -> null
    }

/**
 * The per-(sharer, sharee) notification flood cap, per rolling 24 hours: once a sharer has already
 * caused this many share notifications (SHARED + WITHDRAWN, counted from `document_shares`
 * `created_at`/`withdrawn_at` — no extra table; since V91 a mass share's rows count as ONE notice
 * via their shared `batch_id`) to one sharee in that window, further shares and
 * withdrawals between the pair still happen but mint NO notification (audited `notified=false`).
 * This is the DEFAULT of `sharing.notificationDailyCapPerPair` (`$SHARING_NOTIFICATION_DAILY_CAP_PER_PAIR`,
 * boot-validated 1..1000) — the per-caller rate limit bounds the rate, this bounds what one victim
 * can be made to receive.
 */
const val SHARE_NOTIFICATION_DAILY_CAP_PER_PAIR = 20

/** Derived, never stored: WITHDRAWN beats EXPIRED beats ACTIVE (see [ShareService]). */
@Serializable
enum class ShareStatus { ACTIVE, EXPIRED, WITHDRAWN }

/** The `view` selector of `GET /api/v1/shares`; [wire] is the (camelCase) query-param value. */
enum class ShareListView(val wire: String) {
    WITH_ME("withMe"),
    BY_ME("byMe"),
    DOCUMENT("document"),
}

/** One sharee per call — the SPA dialog submits sequentially and itemizes failures. */
@Serializable
data class ShareRequest(
    val resourceType: ShareableResourceType,
    val resourceId: UInt,
    val shareeId: UInt,
    /** Strict ISO date, inclusive through that day; null = open-ended. */
    val expiresOn: String? = null,
)

/** Mass share (v4.10.0): the most documents one `POST /shares/batch` call may name. */
const val MAX_BATCH_SHARE_RESOURCES = 200

/** Mass share (v4.10.0): the most sharees one `POST /shares/batch` call may name. */
const val MAX_BATCH_SHARE_SHAREES = 20

/**
 * Mass share (v4.10.0) — many documents of ONE kind × many sharees in one call (at most
 * [MAX_BATCH_SHARE_RESOURCES] × [MAX_BATCH_SHARE_SHAREES] = 4,000 pairs). The list-size and
 * uniqueness rules are schema-declared (`minItems`/`maxItems`/`uniqueItems`), so a violation is
 * the "malformed body" class of 400, enforced by [validateShareBatchShape].
 */
@Serializable
data class ShareBatchRequest(
    val resourceType: ShareableResourceType,
    val resourceIds: List<UInt>,
    val shareeIds: List<UInt>,
    /** Strict ISO date, inclusive through that day; null = open-ended — same rule as [ShareRequest]. */
    val expiresOn: String? = null,
)

/** The per-item outcome of a mass share; `CREATED`/`ALREADY_SHARED` are per (document, sharee) pair. */
@Serializable
enum class ShareBatchItemStatus { CREATED, ALREADY_SHARED, FORBIDDEN, NOT_FOUND }

/**
 * One line of a mass-share report. `CREATED`/`ALREADY_SHARED` name the pair and the share's id
 * (the new row, or the existing ACTIVE one); `FORBIDDEN`/`NOT_FOUND` are per document, with a
 * null [shareeId] and [shareId].
 */
@Serializable
data class ShareBatchItem(
    val resourceId: UInt,
    val shareeId: UInt?,
    val status: ShareBatchItemStatus,
    val shareId: UInt?,
)

/**
 * The mass-share report. [batchId] is the `document_shares.batch_id` of every `CREATED` row, null
 * when nothing was created (a pure replay) — no id for a batch that does not exist. The four
 * counts equal the number of [items] with that status.
 */
@Serializable
data class ShareBatchResponse(
    val batchId: String?,
    val items: List<ShareBatchItem>,
    val created: Int,
    val alreadyShared: Int,
    val forbidden: Int,
    val notFound: Int,
)

@Serializable
data class ShareResponse(
    val id: UInt,
    val resourceType: ShareableResourceType,
    val resourceId: UInt,
    val sharerId: UInt,
    val sharerName: String,
    val shareeId: UInt,
    val shareeName: String,
    val expiresOn: String?,
    // Epoch milliseconds; server-managed.
    val createdAt: Long,
    val status: ShareStatus,
    val withdrawnAt: Long?,
    val withdrawnById: UInt?,
    val withdrawnByName: String?,
    // In-app path of the shared document's view screen, derived from the kind and id (the document
    // may have been deleted since — opening it then answers 404 or the lapse 403).
    val link: String,
    // Content-free facts about the document, SNAPSHOTTED when the share was created (title/party
    // columns only, never decrypted content, never a status) and never refreshed — a lapsed or
    // withdrawn share must not keep leaking the document's later state. Null for a row with no
    // snapshot.
    val details: Map<String, String>?,
)

typealias SharePageResponse = PageResponse<ShareResponse>

/**
 * The `expiresOn` rule, checked at CREATE from the route (after the authz guard — 403 wins over
 * 400): a strict ISO date (`parseIsoDateStrict`) no earlier than [today] — the SERVER's today,
 * from [ShareService]'s one clock. There is deliberately no timezone tolerance (unlike the
 * feedback-expiry/goal-due-date idioms): a share that is EXPIRED at birth must never exist or
 * notify anyone. `null` is always fine (open-ended).
 */
internal fun validateShareExpiry(expiresOn: String?, today: LocalDate) {
    if (expiresOn == null) return
    val parsed = parseIsoDateStrict(expiresOn, "expiresOn")
    if (parsed < today) throw BadRequestException("expiresOn must not be in the past")
}

/**
 * The mass-share list-shape rule (schema-declared, the malformed-body class of 400): 1..
 * [MAX_BATCH_SHARE_RESOURCES] documents and 1..[MAX_BATCH_SHARE_SHAREES] sharees, no duplicate id
 * in either list. Runs BEFORE any per-document work, so an oversized request never costs a read.
 */
internal fun validateShareBatchShape(resourceIds: List<UInt>, shareeIds: List<UInt>) {
    if (resourceIds.isEmpty() || resourceIds.size > MAX_BATCH_SHARE_RESOURCES) {
        throw BadRequestException("resourceIds must hold 1 to $MAX_BATCH_SHARE_RESOURCES ids")
    }
    if (shareeIds.isEmpty() || shareeIds.size > MAX_BATCH_SHARE_SHAREES) {
        throw BadRequestException("shareeIds must hold 1 to $MAX_BATCH_SHARE_SHAREES ids")
    }
    if (resourceIds.toSet().size != resourceIds.size) throw BadRequestException("resourceIds must not contain duplicates")
    if (shareeIds.toSet().size != shareeIds.size) throw BadRequestException("shareeIds must not contain duplicates")
}
