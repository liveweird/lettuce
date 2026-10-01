package ch.nokillswit.sharing

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.users.Feature
import io.ktor.util.AttributeKey
import java.util.concurrent.ConcurrentHashMap

val ShareServiceKey = AttributeKey<ShareService>("ShareService")
val ShareRegistryKey = AttributeKey<ShareRegistry>("ShareRegistry")
val ShareAccessKey = AttributeKey<ShareAccess>("ShareAccess")

/**
 * What one feature contributes so its documents can be shared (v4.8.0) — the seam between the
 * generic `sharing/` package and each feature's own read rules. One adapter per feature
 * (`feedbacks/FeedbackShareable.kt`, …), registered in [ShareRegistry] where the services are
 * constructed (`infra/db/Database.kt`). [D] is the feature's detail document, [G] whatever its
 * read guard returns (the days-off grant style; `Unit` for the plain guards).
 *
 * The adapter never re-implements a read rule: [guard] calls the SAME `authz/Guards.kt` guard
 * the feature's read preamble calls, so "may this principal read this document" has exactly one
 * definition. [ShareAccess] hands it a role-stripped principal to evaluate "in their own right".
 */
interface ShareableResource<D : Any, G> {
    val type: ShareableResourceType

    /** The feature flag gating this area — defaults to the type's own mapping. */
    val feature: Feature get() = type.feature

    /** The document, or null when it is missing or soft-deleted (the route answers 404). */
    suspend fun read(id: UInt): D?

    /**
     * The feature's read guard for [principal] and [doc]; returns the guard's grant, throws
     * `ForbiddenException` when the principal may not read the document. Must only throw
     * `ForbiddenException` for a DENIAL — [ShareAccess] swallows exactly that type and nothing else.
     */
    suspend fun guard(principal: CallerPrincipal, doc: D): G

    /**
     * Is [userId] the document's author — the person who sees and may withdraw EVERY share of it
     * (feedback: the provider; 1:1/goal/review: the stored manager; impact log/succession: the
     * owner; team KPI: whoever passes the manage predicate, which needs the chain walk — hence suspend).
     */
    suspend fun isAuthor(userId: UInt, doc: D): Boolean

    /**
     * Content-free, localizable facts about [doc] for the Shared screen (plaintext title/party
     * columns only — never a decrypt; keys per type are listed on `ShareResponse.details` in the
     * OpenAPI spec, and never a status). Called ONCE, when a share is created, and stored as the
     * share's snapshot: the Shared screen never looks the document up again, so a share that has
     * lapsed cannot leak the document's later title or state.
     */
    suspend fun label(doc: D): Map<String, String>

    /** The in-app path of the document's view screen (the share notification's link). */
    fun viewPath(id: UInt): String
}

/**
 * The per-application set of registered adapters, keyed by [ShareableResourceType]. Built empty
 * in `infra/db/Database.kt` and filled there as each feature's adapter lands; a type with no
 * adapter is simply not shareable yet (the routes answer 404 for it). Tests register fakes
 * through [register] — every test application boots its own registry, so nothing leaks.
 */
class ShareRegistry {
    private val adapters = ConcurrentHashMap<ShareableResourceType, ShareableResource<*, *>>()

    /** Registers (or replaces) the adapter for its type. */
    fun register(adapter: ShareableResource<*, *>) {
        adapters[adapter.type] = adapter
    }

    fun forType(type: ShareableResourceType): ShareableResource<*, *>? = adapters[type]
}
