package ch.nokillswit.succession

import kotlinx.serialization.Serializable

/**
 * The succession-plan history's structured event vocabulary (v2.46.0) and the pure descriptor
 * builders the routes use to record them — the ImpactLogEvents shape: side-effect-free (no DB)
 * so it can be unit-tested directly; persistence happens in the route (see SuccessionRoutes).
 *
 * Params carry enum NAMES, numbers, and candidate display names only — NEVER loss-impact or
 * competency-gap text (both lists are encrypted at rest; events are readable by exactly the
 * plan's readers, who see candidate names in the document anyway, and candidate_id is already
 * a plaintext FK — a name here is the same disclosure class). Nomination changes are recorded
 * as PLAN-level events identified by the candidate's name.
 */
@Serializable
enum class SuccessionEventType {
    CREATED,
    CRITICALITY_CHANGED,
    RISK_CHANGED,
    BENCH_DEPTH_CHANGED,
    LOSS_IMPACT_CHANGED,
    REVIEW_COMPLETED,
    CLOSED,
    DELETED,
    NOMINATION_ADDED,
    NOMINATION_UPDATED,
    NOMINATION_REMOVED,
    PRIMARY_DEMOTED,
}

/** What happened, ready for [SuccessionEventService] to persist against a plan + actor. */
data class SuccessionEventDescriptor(
    val type: SuccessionEventType,
    val params: Map<String, String> = emptyMap(),
)

// The stable field-name vocabulary of the NOMINATION_UPDATED event's `changed` list
// (SPA-localized). Content-bearing fields contribute their NAME only.
private const val FIELD_CANDIDATE = "candidate"
private const val FIELD_READINESS = "readiness"
private const val FIELD_NOMINATION_TYPE = "nominationType"
private const val FIELD_AWARENESS = "awareness"
private const val FIELD_COMPETENCY_GAPS = "competencyGaps"
private const val FIELD_GOALS = "goals"

internal fun successionPlanCreationEvent(request: SuccessionPlanCreateRequest) =
    SuccessionEventDescriptor(
        SuccessionEventType.CREATED,
        mapOf(
            "roleCriticality" to request.roleCriticality.name,
            "retentionRisk" to request.retentionRisk.name,
            "targetBenchDepth" to request.targetBenchDepth.toString(),
        ),
    )

/**
 * The definition PUT's per-field fan-out (the goals idiom): one event per changed field, with
 * from/to for the enum/number fields; the loss-impact list contributes a bare name-only event
 * (its texts are encrypted — equality is compared over the decrypted list, content never rides
 * params). A no-op PUT yields an empty list (no empty events).
 */
internal fun successionPlanUpdateEvents(
    before: SuccessionPlanResponse,
    after: SuccessionPlanUpdate,
): List<SuccessionEventDescriptor> {
    val events = mutableListOf<SuccessionEventDescriptor>()
    if (before.roleCriticality != after.roleCriticality) {
        events += SuccessionEventDescriptor(
            SuccessionEventType.CRITICALITY_CHANGED,
            mapOf("from" to before.roleCriticality.name, "to" to after.roleCriticality.name),
        )
    }
    if (before.retentionRisk != after.retentionRisk) {
        events += SuccessionEventDescriptor(
            SuccessionEventType.RISK_CHANGED,
            mapOf("from" to before.retentionRisk.name, "to" to after.retentionRisk.name),
        )
    }
    if (before.targetBenchDepth != after.targetBenchDepth) {
        events += SuccessionEventDescriptor(
            SuccessionEventType.BENCH_DEPTH_CHANGED,
            mapOf(
                "from" to before.targetBenchDepth.toString(),
                "to" to after.targetBenchDepth.toString(),
            ),
        )
    }
    if (before.lossImpact != after.lossImpact) {
        events += SuccessionEventDescriptor(SuccessionEventType.LOSS_IMPACT_CHANGED)
    }
    return events
}

internal fun successionReviewCompletedEvent() =
    SuccessionEventDescriptor(SuccessionEventType.REVIEW_COMPLETED)

internal fun successionPlanClosedEvent() =
    SuccessionEventDescriptor(SuccessionEventType.CLOSED)

/** Minted but unreachable via the API afterwards (the read preamble 404s the soft-deleted plan). */
internal fun successionPlanDeletedEvent() =
    SuccessionEventDescriptor(SuccessionEventType.DELETED)

internal fun nominationAddedEvent(created: SuccessionNominationResponse) =
    SuccessionEventDescriptor(
        SuccessionEventType.NOMINATION_ADDED,
        mapOf(
            "candidateName" to created.candidateName,
            "readiness" to created.readiness.name,
            "nominationType" to created.nominationType.name,
            "awareness" to created.awareness.name,
        ),
    )

/**
 * ONE NOMINATION_UPDATED event whose `changed` param comma-joins the touched field names
 * (stable candidate → readiness → type → awareness → gaps → goals order); enum fields
 * additionally carry `<field>From`/`<field>To`. The candidate slot is name-only — the NEW
 * candidate's name would need a read, and the before-name in `candidateName` already
 * identifies the card. Gaps changes (text edits AND filled ticks alike) and goal-link changes
 * contribute names only. A no-op PUT returns null (no empty events).
 */
internal fun nominationUpdateEvents(
    before: SuccessionNominationResponse,
    after: SuccessionNominationRequest,
): SuccessionEventDescriptor? {
    val changed = mutableListOf<String>()
    val params = mutableMapOf<String, String>()
    if (before.candidateId != after.candidateId) changed += FIELD_CANDIDATE
    if (before.readiness != after.readiness) {
        changed += FIELD_READINESS
        params["readinessFrom"] = before.readiness.name
        params["readinessTo"] = after.readiness.name
    }
    if (before.nominationType != after.nominationType) {
        changed += FIELD_NOMINATION_TYPE
        params["nominationTypeFrom"] = before.nominationType.name
        params["nominationTypeTo"] = after.nominationType.name
    }
    if (before.awareness != after.awareness) {
        changed += FIELD_AWARENESS
        params["awarenessFrom"] = before.awareness.name
        params["awarenessTo"] = after.awareness.name
    }
    if (before.competencyGaps != after.competencyGaps) changed += FIELD_COMPETENCY_GAPS
    if (before.goals.map { it.id } != after.goalIds) changed += FIELD_GOALS
    if (changed.isEmpty()) return null
    params["candidateName"] = before.candidateName
    params["changed"] = changed.joinToString(",")
    return SuccessionEventDescriptor(SuccessionEventType.NOMINATION_UPDATED, params)
}

internal fun nominationRemovedEvent(removed: SuccessionNominationResponse) =
    SuccessionEventDescriptor(
        SuccessionEventType.NOMINATION_REMOVED,
        mapOf("candidateName" to removed.candidateName),
    )

/** The one-primary rule's side effect (V69): the standing PRIMARY the new choice displaced. */
internal fun primaryDemotedEvent(demoted: SuccessionNominationResponse) =
    SuccessionEventDescriptor(
        SuccessionEventType.PRIMARY_DEMOTED,
        mapOf("candidateName" to demoted.candidateName),
    )
