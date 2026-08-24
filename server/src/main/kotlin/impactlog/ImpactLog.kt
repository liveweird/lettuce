package ch.nokillswit.impactlog

import ch.nokillswit.infra.paging.PageResponse
import ch.nokillswit.infra.parseIsoDateStrict
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable

const val MAX_IMPACT_TEXT_LENGTH = 5000
const val MAX_IMPACT_TITLE_LENGTH = 200

/**
 * Body of `POST /impact-log` and `PUT /impact-log/{id}` — the owner is always the caller (a
 * journal has exactly one author), so no user id travels in the payload. The four sections are
 * markdown documents (the feedback-content convention), all required non-blank; the period is a
 * pair of ISO dates, start ≤ end. Overlapping periods across entries are deliberately allowed —
 * two accomplishments may share a quarter.
 */
@Serializable
data class ImpactEntryRequest(
    // Short single-line identity, plaintext (lists sort/filter on it — the goals.title rule).
    val title: String,
    val periodStart: String,
    val periodEnd: String,
    val whatHappened: String,
    val contribution: String,
    val whyItMattered: String,
    val evidence: String,
)

@Serializable
data class ImpactEntryResponse(
    val id: UInt,
    val userId: UInt,
    // Resolved owner display name.
    val userName: String,
    // Plaintext; '' only on pre-V66 rows (required non-blank on every create/update since).
    val title: String,
    // ISO YYYY-MM-DD, start ≤ end.
    val periodStart: String,
    val periodEnd: String,
    val whatHappened: String,
    val contribution: String,
    val whyItMattered: String,
    val evidence: String,
    val createdAt: Long,
    val lastModified: Long,
)

@Serializable
data class ImpactEntryListItem(
    val id: UInt,
    val userId: UInt,
    val userName: String,
    val userDeleted: Boolean,
    // The row's identity on the lists (v2.37.0 — replaced the decrypted what-happened
    // preview); section texts never ride list rows.
    val title: String,
    val periodStart: String,
    val periodEnd: String,
    val createdAt: Long,
    val lastModified: Long,
)

typealias ImpactEntryPageResponse = PageResponse<ImpactEntryListItem>

@Serializable
data class ImpactEntryEvent(
    val entryId: UInt,
    val userId: UInt,
    val type: ImpactEntryEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class ImpactEntryEventResponse(
    val id: UInt,
    val entryId: UInt,
    val userId: UInt,
    val userName: String,
    val timestamp: Long,
    val type: ImpactEntryEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class ImpactEntryEventListResponse(
    val items: List<ImpactEntryEventResponse>,
)

/**
 * Validates an entry payload (create and update share the shape): strict zero-padded ISO period
 * dates (the VARCHAR(10) lexicographic-ordering rule) with start ≤ end — past periods are fine,
 * a journal records history — and all four sections non-blank within the shared bound.
 */
internal fun validateImpactEntry(request: ImpactEntryRequest) {
    if (request.title.isBlank()) throw BadRequestException("Title must not be blank")
    if (request.title.length > MAX_IMPACT_TITLE_LENGTH) {
        throw BadRequestException("Title must be at most $MAX_IMPACT_TITLE_LENGTH characters")
    }
    parseIsoDateStrict(request.periodStart, "Period start")
    parseIsoDateStrict(request.periodEnd, "Period end")
    if (request.periodStart > request.periodEnd) {
        throw BadRequestException("Period start must not be after period end")
    }
    validateSection(request.whatHappened, "What happened")
    validateSection(request.contribution, "My contribution")
    validateSection(request.whyItMattered, "Why it mattered")
    validateSection(request.evidence, "Evidence")
}

private fun validateSection(value: String, label: String) {
    if (value.isBlank()) throw BadRequestException("$label must not be blank")
    if (value.length > MAX_IMPACT_TEXT_LENGTH) {
        throw BadRequestException("$label must be at most $MAX_IMPACT_TEXT_LENGTH characters")
    }
}
