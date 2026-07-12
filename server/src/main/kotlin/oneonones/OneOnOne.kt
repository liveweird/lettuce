package ch.nokillswit.oneonones

import ch.nokillswit.infra.paging.PageResponse
import kotlinx.serialization.Serializable

/** Who an action item is assigned to — always one of the meeting's two parties. */
@Serializable
enum class ActionItemOwner { MANAGER, SUBORDINATE }

/**
 * A point-discussed / decision-made entry in a request body. An [id] identifies an existing row
 * on `PUT` (absent = a new item); create requests must not carry ids. Items are persisted in
 * payload order — the list order IS the stored order.
 */
@Serializable
data class OneOnOneItemInput(
    val id: UInt? = null,
    val content: String,
)

/** An action-item entry in a request body; same id semantics as [OneOnOneItemInput]. */
@Serializable
data class OneOnOneActionItemInput(
    val id: UInt? = null,
    val content: String,
    val owner: ActionItemOwner,
    // ISO YYYY-MM-DD; null = no due date.
    val dueDate: String? = null,
    val resolved: Boolean = false,
)

/**
 * Body of `POST /one-on-ones`. The caller must be the manager (the author); `managerId` is taken
 * from the JWT, never from the body. Unresolved action items of the pair's previous meeting are
 * copied in server-side, ahead of any items supplied here.
 */
@Serializable
data class OneOnOneCreateRequest(
    val subordinateId: UInt,
    // ISO YYYY-MM-DD.
    val meetingDate: String,
    val points: List<OneOnOneItemInput> = emptyList(),
    val decisions: List<OneOnOneItemInput> = emptyList(),
    val actionItems: List<OneOnOneActionItemInput> = emptyList(),
)

/**
 * Body of `PUT /one-on-ones/{id}` — the complete editable document (full replace). The parties
 * are immutable after creation. Existing items carry their `id`; rows missing from the payload
 * are deleted; id-less entries are inserted. Positions are rewritten from payload order.
 */
@Serializable
data class OneOnOneUpdateRequest(
    val meetingDate: String,
    val points: List<OneOnOneItemInput>,
    val decisions: List<OneOnOneItemInput>,
    val actionItems: List<OneOnOneActionItemInput>,
)

@Serializable
data class OneOnOneItemResponse(
    val id: UInt,
    val content: String,
)

@Serializable
data class OneOnOneActionItemResponse(
    val id: UInt,
    val content: String,
    val owner: ActionItemOwner,
    val dueDate: String?,
    val resolved: Boolean,
    // The source action item in the pair's previous meeting this one was carried over from;
    // null for items authored in this meeting (or when the source row no longer exists).
    val copiedFromId: UInt?,
    // ISO date of the item's earliest surviving appearance in its carry-over chain — the same
    // meeting the history modal shows first (soft-deleted ancestor meetings are skipped).
    // Null when the item first appeared in this meeting (or the chain no longer survives).
    // Read-model only, never accepted on write.
    val firstAppearedOn: String? = null,
)

/** The full meeting document; also the before-image for the per-item event diff. */
@Serializable
data class OneOnOneResponse(
    val id: UInt,
    val managerId: UInt,
    val managerName: String,
    val subordinateId: UInt,
    val subordinateName: String,
    val meetingDate: String,
    val lastModified: Long,
    val points: List<OneOnOneItemResponse>,
    val decisions: List<OneOnOneItemResponse>,
    val actionItems: List<OneOnOneActionItemResponse>,
)

@Serializable
data class OneOnOneListItem(
    val id: UInt,
    val managerId: UInt,
    val managerName: String,
    val managerDeleted: Boolean,
    val subordinateId: UInt,
    val subordinateName: String,
    val subordinateDeleted: Boolean,
    val meetingDate: String,
    val lastModified: Long,
    val pointCount: Int,
    val decisionCount: Int,
    val actionItemCount: Int,
    val openActionItemCount: Int,
)

typealias OneOnOnePageResponse = PageResponse<OneOnOneListItem>

/** One appearance of an action item (or a copy of it) in a meeting, for the history view. */
@Serializable
data class ActionItemHistoryEntry(
    val actionItemId: UInt,
    val meetingId: UInt,
    val meetingDate: String,
    val content: String,
    val owner: ActionItemOwner,
    val dueDate: String?,
    val resolved: Boolean,
)

@Serializable
data class ActionItemHistoryResponse(
    val items: List<ActionItemHistoryEntry>,
)

/**
 * Internal create input for a 1:1 meeting audit event. There is no public create endpoint:
 * events are minted as a side-effect of meeting create/update/delete (see [OneOnOneEvents] for
 * the descriptors) and persisted via [OneOnOneEventService.create]. The timestamp is
 * server-managed.
 */
@Serializable
data class OneOnOneEvent(
    val meetingId: UInt,
    // The user who performed the change (the acting caller — in practice always the manager).
    val userId: UInt,
    // Structured event; the SPA renders it in the viewer's language.
    val type: OneOnOneEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class OneOnOneEventResponse(
    val id: UInt,
    val meetingId: UInt,
    val userId: UInt,
    // Display name of the acting user; server-resolved, read-only.
    val userName: String,
    // Epoch milliseconds when the event was recorded. Server-managed.
    val timestamp: Long,
    // Structured event for client-side localization.
    val type: OneOnOneEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class OneOnOneEventListResponse(
    val items: List<OneOnOneEventResponse>,
)
