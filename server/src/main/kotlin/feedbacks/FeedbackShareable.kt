package ch.nokillswit.feedbacks

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.requireFeedbackReadAllowingManager
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType

/** A feedback with its id — [Feedback] itself carries none, and the read guard wants it (HR audit event). */
data class FeedbackDoc(val id: UInt, val feedback: Feedback)

/**
 * The feedback read matrix for [principal] — the ONE call site of `requireFeedbackReadAllowingManager`
 * with the manager-chain lambda bound to the principal, shared by the read preamble
 * (`FeedbackRoutes.kt`) and the sharing adapter below, so "may this person read this feedback"
 * has a single definition. Throws `ForbiddenException` on a denial.
 */
internal suspend fun FeedbackService.requireReadable(principal: CallerPrincipal, doc: FeedbackDoc) {
    requireFeedbackReadAllowingManager(principal, doc.feedback, doc.id) {
        managesAnySubject(principal.userId, doc.feedback.subjectIds)
    }
}

/**
 * Feedback's document-sharing adapter (v4.8.0, see `.claude/docs/features/sharing.md`). [guard]
 * is the RAW read guard — never the share-aware route preamble, which would make a share-granted
 * reader look like an own-right reader and so allow re-sharing. The author (who sees and may
 * withdraw every share of the feedback) is the provider. Labels are the plaintext party names
 * only — never the encrypted content.
 */
class FeedbackShareable(private val feedbackService: FeedbackService) : ShareableResource<FeedbackDoc, Unit> {
    override val type = ShareableResourceType.FEEDBACK

    override suspend fun read(id: UInt): FeedbackDoc? = feedbackService.read(id)?.let { FeedbackDoc(id, it) }

    override suspend fun guard(principal: CallerPrincipal, doc: FeedbackDoc) =
        feedbackService.requireReadable(principal, doc)

    override suspend fun isAuthor(userId: UInt, doc: FeedbackDoc): Boolean = userId == doc.feedback.providerId

    override suspend fun label(doc: FeedbackDoc): Map<String, String> {
        val names = feedbackService.partyNames(doc.feedback)
        return mapOf(
            "provider" to (names[doc.feedback.providerId] ?: "#${doc.feedback.providerId}"),
            "subjects" to doc.feedback.subjectIds.joinToString(", ") { names[it] ?: "#$it" },
        )
    }

    override fun viewPath(id: UInt): String = "/feedback/$id/view"
}
