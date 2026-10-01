package ch.nokillswit.sharing

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.users.UserService

/** How a read was granted: in the caller's own right, or through a share (and whose). */
sealed interface ReadVia<out G> {
    val grant: G

    data class Own<out G>(override val grant: G) : ReadVia<G>

    /**
     * [principal] is the SHARER as the guard saw them (roles stripped) — the effective principal
     * for any content gate after the read ("the sharee sees at most what the sharer sees"), e.g.
     * the feedback content gate. [sharerName] feeds the SPA's "Shared with you by …" banner.
     */
    data class Shared<out G>(
        val sharerId: UInt,
        val sharerName: String,
        val principal: CallerPrincipal,
        override val grant: G,
    ) : ReadVia<G>
}

/** The 403 detail when shares exist but none of their sharers can open the document any more. */
internal const val SHARE_LAPSED_DETAIL = "The person who shared this no longer has access to it"

/**
 * Document sharing's read-side authorization (v4.8.0): reuses every existing read guard verbatim
 * by evaluating it for a **role-stripped principal**. A principal with `roles = emptySet()` turns
 * every `grantHrRead` branch in `authz/Guards.kt` into a no-op, so the unchanged guard answers
 * exactly "may this person read this document in their own right" — party/author/chain rules
 * and nothing else. Net rule, one line: **a share works exactly while the sharer could open the
 * document themselves without the HR role.** Nothing in `Guards.kt` changed for this.
 */
class ShareAccess(private val shares: ShareService, private val users: UserService) {

    /**
     * Runs [guard] for [caller]; on a `ForbiddenException` — and ONLY that, anything else (a
     * throwing chain walk, say) propagates as the 500 it is — falls back to the caller's active
     * shares of ([type], [id]): for each sharer that is still active (not deleted, not
     * deactivated) with the feature enabled, [guard] runs against the sharer's role-stripped
     * principal and the first pass wins ([ReadVia.Shared]). With no active share the ORIGINAL
     * denial is rethrown untouched (the `authz.denied` audit event is unchanged); with shares
     * that no longer pass — the sharer lost the right, left, or was deactivated — the caller
     * gets the distinct [SHARE_LAPSED_DETAIL] 403 instead.
     *
     * The caller's own feature-gated check (the feature's `xCaller()`) must already have run:
     * this function never evaluates the caller's flags, only the sharers'.
     */
    suspend fun <G> readOrShared(
        caller: CallerPrincipal,
        type: ShareableResourceType,
        id: UInt,
        guard: suspend (CallerPrincipal) -> G,
    ): ReadVia<G> {
        val denial = try {
            return ReadVia.Own(guard(caller))
        } catch (e: ForbiddenException) {
            e
        }
        val sharerIds = shares.activeSharersFor(type, id, caller.userId)
        if (sharerIds.isEmpty()) throw denial
        for (sharerId in sharerIds) {
            val sharer = users.read(sharerId)?.takeUnless { it.deactivated } ?: continue
            val principal = CallerPrincipal(
                userId = sharerId,
                email = sharer.email,
                roles = emptySet(),
                disabledFeatures = sharer.disabledFeatures,
            )
            val grant = evaluate(principal, type, guard) ?: continue
            return ReadVia.Shared(sharerId, sharer.name, principal, grant.value)
        }
        throw ForbiddenException(SHARE_LAPSED_DETAIL)
    }

    /**
     * Does [principal] hold read access to the document in their OWN right — the guard evaluated
     * with the roles stripped (an HR auditor-only reader does not; a share-granted reader does
     * not, because share access is never consulted here). Backs `canShare` and the POST
     * precondition. A principal whose feature flag for [type] is off holds nothing.
     */
    suspend fun <G> holdsOwnRight(
        principal: CallerPrincipal,
        type: ShareableResourceType,
        guard: suspend (CallerPrincipal) -> G,
    ): Boolean = evaluate(principal.copy(roles = emptySet()), type, guard) != null

    private class Grant<G>(val value: G)

    /** The guard's grant for [principal], or null on a denial (feature off or `ForbiddenException`). */
    private suspend fun <G> evaluate(
        principal: CallerPrincipal,
        type: ShareableResourceType,
        guard: suspend (CallerPrincipal) -> G,
    ): Grant<G>? = try {
        requireFeatureEnabled(principal, type.feature)
        Grant(guard(principal))
    } catch (_: ForbiddenException) {
        null
    }
}
