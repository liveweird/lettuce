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
    // In-app path of the shared document's view screen, derived from the kind and id; null only
    // when the kind has no adapter registered (so there is nowhere to point).
    val link: String?,
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
