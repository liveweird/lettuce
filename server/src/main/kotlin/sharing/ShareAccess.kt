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
     * [ownDenied] = the caller's OWN guard denied (the share is their only way in); false means
     * the share UPGRADED a weaker own read — so the caller then certainly has an own-right read
     * to base `canShare` on, and a denied one certainly does not (no second guard run needed).
     */
    data class Shared<out G>(
        val sharerId: UInt,
        val sharerName: String,
        val principal: CallerPrincipal,
        override val grant: G,
        val ownDenied: Boolean,
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
     * shares of ([type], [id]): for each sharer that is still active (not deleted/deactivated)
     * with the feature enabled, [guard] runs against the sharer's role-stripped principal; the
     * first pass wins ([ReadVia.Shared]), preferring a sharer whose read is [sufficient]. With no
     * active share the ORIGINAL denial is rethrown untouched (the `authz.denied` audit event is
     * unchanged); with shares that no longer pass — the sharer lost the right, left, or was
     * deactivated — the caller gets the distinct [SHARE_LAPSED_DETAIL] 403 instead.
     *
     * **A share also upgrades a weaker own read.** [sufficient] (default: always) judges a
     * principal's grant — the feedback content gate, say. When the caller's OWN read passes but is
     * not sufficient, the active shares are tried too: a sharer whose read passes AND is
     * sufficient yields [ReadVia.Shared] (banner, content as the sharer); otherwise the caller's
     * own read stands ([ReadVia.Own]). A denied caller needs only a passing sharer.
     *
     * The caller's own feature-gated check (the feature's `xCaller()`) must already have run:
     * this function never evaluates the caller's flags, only the sharers'.
     */
    suspend fun <G> readOrShared(
        caller: CallerPrincipal,
        type: ShareableResourceType,
        id: UInt,
        sufficient: (CallerPrincipal, G) -> Boolean = { _, _ -> true },
        guard: suspend (CallerPrincipal) -> G,
    ): ReadVia<G> {
        val own = try {
            Grant(guard(caller))
        } catch (e: ForbiddenException) {
            return sharedOrThrow(caller, type, id, sufficient, guard, denial = e)
        }
        if (sufficient(caller, own.value)) return ReadVia.Own(own.value)
        // Own read passes but is too weak (e.g. content-blank): only a SUFFICIENT share upgrades it.
        val sharerIds = shares.activeSharersFor(type, id, caller.userId)
        val upgrade = bestShared(sharerIds, type, sufficient, guard, ownDenied = false)
        return if (upgrade != null && sufficient(upgrade.principal, upgrade.grant)) upgrade else ReadVia.Own(own.value)
    }

    private suspend fun <G> sharedOrThrow(
        caller: CallerPrincipal,
        type: ShareableResourceType,
        id: UInt,
        sufficient: (CallerPrincipal, G) -> Boolean,
        guard: suspend (CallerPrincipal) -> G,
        denial: ForbiddenException,
    ): ReadVia<G> {
        val sharerIds = shares.activeSharersFor(type, id, caller.userId)
        if (sharerIds.isEmpty()) throw denial
        return bestShared(sharerIds, type, sufficient, guard, ownDenied = true)
            ?: throw ForbiddenException(SHARE_LAPSED_DETAIL)
    }

    /** The first active sharer whose read passes, preferring one whose read is also [sufficient]. */
    private suspend fun <G> bestShared(
        sharerIds: List<UInt>,
        type: ShareableResourceType,
        sufficient: (CallerPrincipal, G) -> Boolean,
        guard: suspend (CallerPrincipal) -> G,
        ownDenied: Boolean,
    ): ReadVia.Shared<G>? {
        var firstPassing: ReadVia.Shared<G>? = null
        for (sharerId in sharerIds) {
            val sharer = users.read(sharerId)?.takeUnless { it.deactivated } ?: continue
            val principal = CallerPrincipal(
                userId = sharerId,
                email = sharer.email,
                roles = emptySet(),
                disabledFeatures = sharer.disabledFeatures,
            )
            val grant = evaluate(principal, type, guard) ?: continue
            val via = ReadVia.Shared(sharerId, sharer.name, principal, grant.value, ownDenied)
            if (sufficient(principal, grant.value)) return via
            if (firstPassing == null) firstPassing = via
        }
        return firstPassing
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
