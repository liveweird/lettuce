package ch.nokillswit.sharing

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.users.Feature
import io.ktor.util.AttributeKey

val ShareServiceKey = AttributeKey<ShareService>("ShareService")
val ShareRegistryKey = AttributeKey<ShareRegistry>("ShareRegistry")
val ShareAccessKey = AttributeKey<ShareAccess>("ShareAccess")

/**
 * What one feature contributes so its documents can be shared (v4.8.0) — the seam between the
 * generic `sharing/` package and each feature's own read rules. One adapter per feature
 * (`feedbacks/FeedbackShareable.kt`, …), built into the [ShareRegistry] where the services are
 * constructed (`infra/db/Database.kt`, an exhaustive `when` over the resource types). [D] is the
 * feature's detail document, [G] whatever its read guard returns (the days-off grant style; `Unit` for the plain guards).
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
     * owner; days-off calendar: the person themselves; team KPI: whoever passes the manage predicate, which
     * needs the chain walk — hence suspend).
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
 * The per-application set of adapters — **complete by construction**: it is built from a function
 * over EVERY [ShareableResourceType], so [forType] is never null, and the one construction site
 * (`infra/db/Database.kt`) writes that function as an exhaustive `when (type)` with no `else` —
 * adding an enum value without an adapter fails to COMPILE there. Each adapter must report the
 * type it was built for.
 */
class ShareRegistry(adapterFor: (ShareableResourceType) -> ShareableResource<*, *>) {
    private val adapters: Map<ShareableResourceType, ShareableResource<*, *>> =
        ShareableResourceType.entries.associateWith { type ->
            adapterFor(type).also { check(it.type == type) { "The adapter for $type reports ${it.type}" } }
        }

    fun forType(type: ShareableResourceType): ShareableResource<*, *> = adapters.getValue(type)
}
