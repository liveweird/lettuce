package ch.nokillswit.sharing

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ConflictException
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.UnauthorizedException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.infra.config.optionalConfigInt
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.infra.paging.uintOnlyForView
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.users.UserServiceKey
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Parameters
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.ratelimit.RateLimitName
import io.ktor.server.plugins.ratelimit.rateLimit
import io.ktor.server.request.receive
import io.ktor.server.resources.get
import io.ktor.server.resources.href
import io.ktor.server.resources.post
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

/** The per-caller RateLimit bucket name — registered in auth/AuthRoutes.kt's single install. */
const val SHARES_RATE_LIMIT = "shares"

/**
 * The mass share's OWN per-caller bucket (a separate, much smaller limit): one batch call fans
 * out up to 20 summary notices (+ email + Teams), so it must not ride the single-share bucket.
 */
const val SHARES_BATCH_RATE_LIMIT = "shares-batch"

@Serializable
@Resource("/api/v1/shares")
class Shares {
    /** `POST /api/v1/shares/batch` (v4.10.0) — a constant segment, so it wins over `{id}` in routing. */
    @Serializable
    @Resource("batch")
    class Batch(val parent: Shares = Shares())

    @Serializable
    @Resource("{id}")
    class Id(val parent: Shares = Shares(), val id: UInt) {
        @Serializable
        @Resource("withdraw")
        class Withdraw(val parent: Id)
    }
}

/** A resolved document behind its adapter, with the type parameters erased for the generic routes. */
private class ResolvedDocument(
    val adapter: ShareableResource<*, *>,
    val guard: suspend (CallerPrincipal) -> Unit,
    val isAuthor: suspend (UInt) -> Boolean,
    val label: suspend () -> Map<String, String>,
)

/** Reads the document through its adapter (null = missing/soft-deleted) and erases `D`/`G`. */
private suspend fun <D : Any, G> ShareableResource<D, G>.resolve(id: UInt): ResolvedDocument? {
    val doc = read(id) ?: return null
    return ResolvedDocument(
        adapter = this,
        guard = { principal ->
            guard(principal, doc)
            Unit
        },
        isAuthor = { userId -> isAuthor(userId, doc) },
        label = { label(doc) },
    )
}

private fun Parameters.shareView(): ShareListView {
    val raw = optionalString("view") ?: return ShareListView.WITH_ME
    return ShareListView.entries.firstOrNull { it.wire == raw } ?: throw BadRequestException(
        "Unknown view: $raw (allowed: ${ShareListView.entries.joinToString { it.wire }})",
    )
}

private fun ShareRecord.toResponse(link: String) = ShareResponse(
    id = id,
    resourceType = resourceType,
    resourceId = resourceId,
    sharerId = sharerId,
    sharerName = sharerName,
    shareeId = shareeId,
    shareeName = shareeName,
    expiresOn = expiresOn,
    createdAt = createdAt,
    status = status,
    withdrawnAt = withdrawnAt,
    withdrawnById = withdrawnById,
    withdrawnByName = withdrawnByName,
    link = link,
    details = details,
)

/**
 * `/api/v1/shares` (v4.8.0) — the one central sharing resource, in front of every feature's
 * adapter ([ShareRegistry]). Read the order of each handler as the contract: feature gate →
 * adapter read (404 — read-before-guard, existence is already disclosed by the feature GETs) →
 * own-right guard (403) → payload validation (400, AFTER the guard) → the locked create (409).
 * `POST` has to receive its body first (the type that picks the feature flag and the adapter
 * lives IN it), so a malformed body is the one 400 that precedes the gates. Every
 * [ShareableResourceType] has an adapter ([ShareRegistry] is complete by construction).
 *
 * `POST /api/v1/shares/batch` (v4.10.0, mass share) evaluates in this order: malformed body 400 →
 * the caller's feature flag for the area 403 → the kind must be batchable (400) → the list shape
 * (sizes/duplicates, schema-declared, 400) → per document in request order: read (missing = a
 * `NOT_FOUND` item) then the own-right guard (failing = a `FORBIDDEN` item) → NO shareable
 * document at all is the whole-request 403 (any `FORBIDDEN`) or 404 (all missing), BEFORE any
 * semantic 400, so a caller with no right learns nothing about them → semantic validation 400
 * (`expiresOn`, sharees ≠ caller, existing, active) → one locked transaction → ONE `share.batch_created`
 * audit event (never per-share `share.created`) → one summary notification per notified sharee.
 */
fun Application.configureShareRoutes() {
    val shareService = attributes[ShareServiceKey]
    // The per-(sharer, sharee) notification flood cap per rolling 24 h — boot-validated like every
    // numeric knob (blank = SHARE_NOTIFICATION_DAILY_CAP_PER_PAIR).
    val dailyCap = optionalConfigInt(environment.config, "sharing.notificationDailyCapPerPair", min = 1, max = 1000)
        ?: SHARE_NOTIFICATION_DAILY_CAP_PER_PAIR
    // Looked up per call (cheap): the registry is the one piece of wiring a test swaps for stub
    // adapters AFTER the modules ran (the BlocklistOutageTest idiom — an attribute read at request
    // time rather than captured at configuration time).
    fun registry() = attributes[ShareRegistryKey]
    val shareAccess = attributes[ShareAccessKey]
    val notificationService = attributes[NotificationServiceKey]
    val userService = attributes[UserServiceKey]

    suspend fun resolveDocument(type: ShareableResourceType, id: UInt): ResolvedDocument {
        return registry().forType(type).resolve(id) ?: throw NotFoundException("Document not found")
    }

    // The wire form of a stored share: `details` is the creation-time snapshot (never a live
    // lookup — a lapsed share must not leak the document's later state); `link` is derived from
    // kind + id (the document may be gone by now — opening it then answers 404/lapse).
    fun ShareRecord.toWire(): ShareResponse =
        toResponse(link = registry().forType(resourceType).viewPath(resourceId))

    // The sharer manages their own shares always (even with the area's flag since switched off —
    // taking a share back is never blocked); anyone else must be the document's AUTHOR, who
    // sees and may withdraw every share of it (the author path is feature-gated like the rest
    // of the area). A stranger — and the document's subject — is 403.
    suspend fun requireSharerOrAuthor(caller: CallerPrincipal, record: ShareRecord) {
        if (record.sharerId == caller.userId) return
        requireFeatureEnabled(caller, record.resourceType.feature)
        val document = registry().forType(record.resourceType).resolve(record.resourceId)
        // The author acts "while they can still read the document": authorship alone is not enough,
        // the same own-right evaluation the share POST demands (HR-auditor access is not it).
        val mayManage = document != null && document.isAuthor(caller.userId) &&
            shareAccess.holdsOwnRight(caller, record.resourceType) { document.guard(it) }
        if (!mayManage) throw ForbiddenException("Only the sharer or the document's author may manage this share")
    }

    // `view=document`'s row scope: the author sees every share of the document, an own-right
    // holder only the rows they created (the subject never sees others' shares), anyone else —
    // HR auditor-only access included — is 403. Returns the sharer id to pin, null = no pin.
    suspend fun documentSharerScope(caller: CallerPrincipal, type: ShareableResourceType, id: UInt): UInt? {
        requireFeatureEnabled(caller, type.feature)
        val document = resolveDocument(type, id)
        if (document.isAuthor(caller.userId)) return null
        if (shareAccess.holdsOwnRight(caller, type) { document.guard(it) }) return caller.userId
        throw ForbiddenException("Only someone who can read this document in their own right may list its shares")
    }

    // Mass share (v4.10.0) — the contract of the order is in the KDoc above and `.claude/docs/features/sharing.md`.
    suspend fun shareBatch(caller: CallerPrincipal, request: ShareBatchRequest): ShareBatchResponse {
        val type = request.resourceType
        requireFeatureEnabled(caller, type.feature)
        val summaryType = type.batchSharedNotification
            ?: throw BadRequestException("Batch sharing is not available for this document kind")
        validateShareBatchShape(request.resourceIds, request.shareeIds)

        // Per document, in request order: missing -> NOT_FOUND, not readable in the caller's OWN right -> FORBIDDEN.
        val shareable = LinkedHashMap<UInt, ResolvedDocument>()
        val forbidden = LinkedHashSet<UInt>()
        val notFound = LinkedHashSet<UInt>()
        for (resourceId in request.resourceIds) {
            val document = registry().forType(type).resolve(resourceId)
            when {
                document == null -> notFound += resourceId
                !shareAccess.holdsOwnRight(caller, type) { document.guard(it) } -> forbidden += resourceId
                else -> shareable[resourceId] = document
            }
        }
        if (shareable.isEmpty()) {
            if (forbidden.isNotEmpty()) {
                throw ForbiddenException("You can't share any of these documents in your own right")
            }
            throw NotFoundException("None of the documents exist")
        }

        // After the authz outcome above (403/404 win over 400).
        validateShareExpiry(request.expiresOn, shareService.today())
        if (caller.userId in request.shareeIds) throw BadRequestException("A document cannot be shared with yourself")
        request.shareeIds.forEach { userService.read(it) ?: throw BadRequestException("Referenced user does not exist") }
        userService.requireNoDeactivatedUsers(request.shareeIds)
        // The sharer's display name for the summary notices, read BEFORE the commit so a concurrent
        // soft-delete of the caller cannot turn a committed batch into a post-commit 500.
        val sharerName = (userService.read(caller.userId) ?: throw UnauthorizedException("Caller no longer exists")).name

        val outcome = shareService.createBatch(
            type = type,
            resourceIds = shareable.keys.toList(),
            sharerId = caller.userId,
            shareeIds = request.shareeIds,
            expiresOn = request.expiresOn,
            details = shareable.mapValues { (_, document) -> document.label() },
            notificationCap = dailyCap,
        )
        // No batch id for a batch that created nothing (a pure replay stores no row to join on).
        val batchId = outcome.batchId.takeIf { outcome.created.isNotEmpty() }
        val createdPerSharee = outcome.created.groupingBy { it.shareeId }.eachCount()
        // `notifiedSharees` already holds only sharees with a created pair; request order keeps it deterministic.
        val notifiedSharees = request.shareeIds.filter { it in outcome.notifiedSharees }
        fun ids(values: Collection<UInt>) = values.joinToString(",")
        audit(
            "share.batch_created",
            "byUserId" to caller.userId.toLong(),
            "batchId" to batchId,
            "resourceType" to type.name,
            "resourceIds" to ids(request.resourceIds),
            "shareeIds" to ids(request.shareeIds),
            "created" to outcome.created.size,
            "alreadyShared" to outcome.duplicates.size,
            "forbidden" to forbidden.size,
            "notFound" to notFound.size,
            "forbiddenResourceIds" to ids(forbidden),
            "notFoundResourceIds" to ids(notFound),
            "expiresOn" to request.expiresOn,
            "notifiedShareeIds" to ids(notifiedSharees),
        )
        // Best-effort side effect after the commit: ONE summary notice per sharee that got at least one
        // new share and had cap room — never the per-share SHARED notice, nothing for the others.
        if (notifiedSharees.isNotEmpty()) {
            notificationService.createAll(
                notifiedSharees.map { shareeId ->
                    batchSharedNotification(
                        summaryType, shareeId, sharerName, createdPerSharee.getValue(shareeId), request.expiresOn, type.batchSharedLink,
                    )
                },
            )
        }

        val createdByPair = outcome.created.associateBy { it.resourceId to it.shareeId }
        val duplicateByPair = outcome.duplicates.associateBy { it.resourceId to it.shareeId }
        val items = request.resourceIds.flatMap { resourceId ->
            when (resourceId) {
                in forbidden -> listOf(ShareBatchItem(resourceId, null, ShareBatchItemStatus.FORBIDDEN, null))
                in notFound -> listOf(ShareBatchItem(resourceId, null, ShareBatchItemStatus.NOT_FOUND, null))
                else -> request.shareeIds.map { shareeId ->
                    val pair = resourceId to shareeId
                    createdByPair[pair]?.let { ShareBatchItem(resourceId, shareeId, ShareBatchItemStatus.CREATED, it.id) }
                        ?: ShareBatchItem(
                            resourceId,
                            shareeId,
                            ShareBatchItemStatus.ALREADY_SHARED,
                            duplicateByPair.getValue(pair).existingId,
                        )
                }
            }
        }
        return ShareBatchResponse(
            batchId = batchId,
            items = items,
            created = outcome.created.size,
            alreadyShared = outcome.duplicates.size,
            forbidden = forbidden.size,
            notFound = notFound.size,
        )
    }

    routing {
        authenticate {
            get<Shares> {
                val caller = call.caller()
                val params = call.request.queryParameters
                // Shape validation first, role/scope gates after (the registered list-ordering rule).
                val view = params.shareView()
                val paging = call.parsePaging(
                    sortable = setOf("id", "createdAt", "expiresOn"),
                    defaultSort = listOf(SortField("createdAt", descending = true)),
                )
                val resourceType = params.optionalEnum<ShareableResourceType>("resourceType")
                val status = params.optionalEnum<ShareStatus>("status")
                val resourceId = params.uintOnlyForView("resourceId", view, ShareListView.DOCUMENT)
                if (view == ShareListView.DOCUMENT && resourceType == null) {
                    throw BadRequestException("resourceType is required for view=document")
                }
                val sharerScope = if (view == ShareListView.DOCUMENT) {
                    documentSharerScope(caller, checkNotNull(resourceType), checkNotNull(resourceId))
                } else {
                    null
                }
                val result = shareService.list(
                    ShareListFilter(
                        view = view,
                        userId = caller.userId,
                        resourceType = resourceType,
                        resourceId = resourceId,
                        status = status,
                        disabledFeatures = caller.disabledFeatures,
                        documentSharerScope = sharerScope,
                    ),
                    paging,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items.map { it.toWire() }, result.total))
            }
            get<Shares.Id> { route ->
                val caller = call.caller()
                val record = shareService.read(route.id) ?: throw NotFoundException("Share not found")
                requireSharerOrAuthor(caller, record)
                call.respond(HttpStatusCode.OK, record.toWire())
            }
            // The mass share has its own per-caller bucket (burst fan-out, see SHARES_BATCH_RATE_LIMIT).
            rateLimit(RateLimitName(SHARES_BATCH_RATE_LIMIT)) {
                post<Shares.Batch> {
                    call.respond(HttpStatusCode.OK, shareBatch(call.caller(), call.receive<ShareBatchRequest>()))
                }
            }
            // The single-share mutations share one per-caller bucket (keyed on userId, see auth/AuthRoutes.kt).
            rateLimit(RateLimitName(SHARES_RATE_LIMIT)) {
                post<Shares> {
                    val caller = call.caller()
                    val request = call.receive<ShareRequest>()
                    val type = request.resourceType
                    requireFeatureEnabled(caller, type.feature)
                    val document = resolveDocument(type, request.resourceId)
                    // Share only what you can read in your OWN right: HR-auditor-only access and
                    // access that itself came from a share are not shareable (no re-sharing).
                    if (!shareAccess.holdsOwnRight(caller, type) { document.guard(it) }) {
                        throw ForbiddenException("Only someone who can read this document in their own right may share it")
                    }
                    // After the authz guard (403 wins over 400).
                    validateShareExpiry(request.expiresOn, shareService.today())
                    if (request.shareeId == caller.userId) throw BadRequestException("A document cannot be shared with yourself")
                    userService.read(request.shareeId) ?: throw BadRequestException("Referenced user does not exist")
                    userService.requireNoDeactivatedUsers(listOf(request.shareeId))
                    // The creation-time snapshot, computed once: stored as `details` AND (for a kind with
                    // notificationLabelKeys — the calendar's `person`) carried into the notice.
                    val label = document.label()
                    // The per-pair notification cap is decided inside the create's locked transaction.
                    val created = when (
                        val outcome = shareService.create(
                            type, request.resourceId, caller.userId, request.shareeId, request.expiresOn, label,
                            notificationCap = dailyCap,
                        )
                    ) {
                        is ShareCreateOutcome.Duplicate -> throw ConflictException(
                            "This document is already shared with that person",
                            instance = call.application.href(Shares.Id(id = outcome.existingId)),
                        )
                        is ShareCreateOutcome.Created -> outcome
                    }
                    val id = created.id
                    val mayNotify = created.notify
                    val record = checkNotNull(shareService.read(id)) { "just-created share $id must exist" }
                    audit(
                        "share.created",
                        "byUserId" to caller.userId.toLong(),
                        "shareId" to id.toLong(),
                        "shareeId" to request.shareeId.toLong(),
                        "resourceType" to type.name,
                        "resourceId" to request.resourceId.toLong(),
                        "expiresOn" to request.expiresOn,
                        // Always the sharer: only someone reading in their own right can create a share.
                        "role" to "sharer",
                        // false = the per-pair daily notification cap swallowed the notice (the share exists).
                        "notified" to mayNotify,
                    )
                    // Best-effort side effect after the commit (the documented consistency model).
                    if (mayNotify) {
                        notificationService.create(
                            shareCreatedNotification(
                                type = type,
                                shareeId = request.shareeId,
                                sharerName = record.sharerName,
                                expiresOn = request.expiresOn,
                                link = document.adapter.viewPath(request.resourceId),
                                labelParams = label,
                                // A calendar's resource id IS the person: sharing one's own calendar reads "their".
                                sharerIsSubject = type == ShareableResourceType.DAYS_OFF_CALENDAR &&
                                    request.resourceId == caller.userId,
                            ),
                        )
                    }
                    call.response.header(HttpHeaders.Location, call.application.href(Shares.Id(id = id)))
                    call.respond(HttpStatusCode.Created, record.toWire())
                }
                post<Shares.Id.Withdraw> { route ->
                    val caller = call.caller()
                    val id = route.parent.id
                    val record = shareService.read(id) ?: throw NotFoundException("Share not found")
                    requireSharerOrAuthor(caller, record)
                    when (val outcome = shareService.withdraw(id, caller.userId, notificationCap = dailyCap)) {
                        ShareWithdrawOutcome.NotFound -> throw NotFoundException("Share not found")
                        ShareWithdrawOutcome.AlreadyWithdrawn -> throw ConflictException("Share is already withdrawn")
                        is ShareWithdrawOutcome.Withdrawn -> {
                            audit(
                                "share.withdrawn",
                                "byUserId" to caller.userId.toLong(),
                                "shareId" to id.toLong(),
                                "sharerId" to record.sharerId.toLong(),
                                "shareeId" to record.shareeId.toLong(),
                                "resourceType" to record.resourceType.name,
                                "resourceId" to record.resourceId.toLong(),
                                "role" to if (caller.userId == record.sharerId) "sharer" else "author",
                                "wasActive" to outcome.wasActive,
                                // false = the SHARED-facing notice was silent: already expired, or swallowed by the
                                // per-pair daily cap (the sharer's own copy on an author withdrawal is never capped).
                                "notified" to outcome.notify,
                            )
                            // A share that had already expired is stamped silently — nobody is told. Otherwise
                            // the sharee's notice is subject to the per-pair cap, the sharer's own copy never is.
                            if (outcome.wasActive) {
                                shareWithdrawnNotifications(
                                    type = record.resourceType,
                                    sharerId = record.sharerId,
                                    sharerName = record.sharerName,
                                    shareeId = record.shareeId,
                                    shareeName = record.shareeName,
                                    actorId = caller.userId,
                                    actorName = outcome.record.withdrawnByName ?: record.sharerName,
                                    // The creation-time snapshot (the calendar's `person`); a calendar's resource id is the person.
                                    labelParams = record.details.orEmpty(),
                                    sharerIsSubject = record.resourceType == ShareableResourceType.DAYS_OFF_CALENDAR &&
                                        record.resourceId == record.sharerId,
                                )
                                    .filter { outcome.notify || it.recipientId != record.shareeId }
                                    .forEach { notificationService.create(it) }
                            }
                            call.respond(HttpStatusCode.NoContent)
                        }
                    }
                }
            }
        }
    }
}
