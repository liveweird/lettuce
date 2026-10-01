package ch.nokillswit.oneonones

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.requireOneOnOneReadAllowingManager
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType

/**
 * The 1:1 read matrix for [principal] — the ONE call site of `requireOneOnOneReadAllowingManager`
 * with the manager-chain lambda bound to the principal, shared by the read preamble
 * (`OneOnOneRoutes.kt`), the action-item history route (which stays own-right only, NOT
 * share-aware — see there) and the sharing adapter below. Throws `ForbiddenException` on a denial.
 */
internal suspend fun OneOnOneService.requireReadable(principal: CallerPrincipal, meeting: OneOnOneResponse) {
    requireOneOnOneReadAllowingManager(principal, meeting) { managesSubordinate(principal.userId, meeting.subordinateId) }
}

/**
 * 1:1 meetings' document-sharing adapter (v4.8.0, see `.claude/docs/features/sharing.md`).
 * [guard] is the RAW read guard — never the share-aware route preamble (that would allow
 * re-sharing). The author (who sees and may withdraw every share of the meeting) is the stored
 * manager. Labels are the two parties' names and the meeting date only — never the encrypted notes.
 */
class OneOnOneShareable(private val oneOnOneService: OneOnOneService) : ShareableResource<OneOnOneResponse, Unit> {
    override val type = ShareableResourceType.ONE_ON_ONE

    override suspend fun read(id: UInt): OneOnOneResponse? = oneOnOneService.read(id)

    override suspend fun guard(principal: CallerPrincipal, doc: OneOnOneResponse) =
        oneOnOneService.requireReadable(principal, doc)

    override suspend fun isAuthor(userId: UInt, doc: OneOnOneResponse): Boolean = userId == doc.managerId

    override suspend fun label(doc: OneOnOneResponse): Map<String, String> =
        mapOf("manager" to doc.managerName, "subordinate" to doc.subordinateName, "meetingDate" to doc.meetingDate)

    override fun viewPath(id: UInt): String = "/one-on-ones/$id/view"
}

/**
 * A sharee sees the shared document, never facts about its SIBLING meetings: the pair's other
 * (unshared) meetings must not leak through the document's read-model fields. So for a read
 * through a share the response drops the chronological floor (`minMeetingDate` — a sibling's
 * date), reports `isLatest = false` (nothing editable, and `true` would reveal that no later
 * meeting exists), and strips from every action item the links to other meetings
 * (`copiedFromId`, `firstAppearedOn`). The meeting's own `meetingDate` and content are what was
 * shared and stay.
 */
internal fun OneOnOneResponse.forSharee(): OneOnOneResponse = copy(
    isLatest = false,
    minMeetingDate = null,
    actionItems = actionItems.map { it.copy(copiedFromId = null, firstAppearedOn = null) },
)
