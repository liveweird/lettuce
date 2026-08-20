package ch.nokillswit.teams

import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.infra.paging.PageResponse
import ch.nokillswit.reviews.PerformanceReviewStatus
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable

@Serializable
data class Team(
    val name: String,
    val managerId: UInt,
    val memberIds: List<UInt> = emptyList(),
)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class TeamResponse(
    val id: UInt,
    val name: String,
    val managerId: UInt,
    val memberIds: List<UInt>,
    // Manager enrichment, populated by the single-team GET only (the users-list `teams`
    // idiom): create/update responses omit the keys entirely rather than sending null.
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val managerName: String? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val managerDeleted: Boolean? = null,
)

fun Team.toResponse(id: UInt) = TeamResponse(id, name, managerId, memberIds)

/** The single-team GET's enriched read: the team plus its manager's display fields. */
data class TeamDetail(
    val team: Team,
    val managerName: String,
    val managerDeleted: Boolean,
) {
    fun toResponse(id: UInt) = TeamResponse(
        id = id,
        name = team.name,
        managerId = team.managerId,
        memberIds = team.memberIds,
        managerName = managerName,
        managerDeleted = managerDeleted,
    )
}

/** A bare (id, name) team reference — the pulse team pickers' row (v2.0.0). */
@Serializable
data class TeamRef(val id: UInt, val name: String)

@Serializable
data class TeamListItem(
    val id: UInt,
    val name: String,
    val managerId: UInt,
    val managerName: String,
    val managerDeleted: Boolean,
)

typealias TeamPageResponse = PageResponse<TeamListItem>

@Serializable
data class TeamMemberListItem(
    val userId: UInt,
    val name: String,
    val email: String,
    val teamId: UInt,
    val teamName: String,
    // Dashboard stats. The 1:1/lastFeedbackAt trio is populated for view=managers and
    // view=managed (direction follows the view: managers — the row user is the meeting's
    // manager / feedback provider; managed — the caller is); the given/received pair below
    // is populated only for view=member, where both feedback directions show at once.
    /** ISO `YYYY-MM-DD` of the latest 1:1 of the (row user, caller) pair in the view's direction. */
    val lastOneOnOneDate: String? = null,
    /** Unresolved action items on that meeting; null exactly when [lastOneOnOneDate] is null. */
    val lastOneOnOneOpenItems: Int? = null,
    /**
     * Epoch ms of the last currently-SENT feedback in the view's direction: managers — this
     * manager last provided the caller feedback the caller can see; managed — the caller last
     * provided this member feedback (provider-side, never visibility-filtered).
     */
    val lastFeedbackAt: Long? = null,
    /**
     * Epoch ms of the SENT moment of the caller's newest currently-SENT feedback about this
     * peer (provider-side, never visibility-filtered — the caller authored it). Populated only
     * for view=member; null for the other views.
     */
    val lastFeedbackGivenAt: Long? = null,
    /**
     * Epoch ms of the SENT moment of the newest currently-SENT feedback this peer provided
     * about the caller that the caller can see (received-scoped — an invisible feedback never
     * leaks). Populated only for view=member; null for the other views.
     */
    val lastFeedbackReceivedAt: Long? = null,
    /**
     * ACTIVE goals of the (row user, caller) pair in the view's direction: managers — goals
     * this manager set for the caller; managed — goals the caller set for this member. `0`
     * when the pair has none (a count has no "absent" state on those views); null only for
     * view=member, which carries no goal stat.
     */
    val activeGoalCount: Int? = null,
    // The caller's latest authored performance review about this member (v1.34.0) — populated
    // only for view=managed (author-side, any status: the caller wrote it, so DRAFTs count);
    // null on the other views and when the caller never reviewed this member.
    /** Id of that review (the card's view/edit link target). */
    val lastReviewId: UInt? = null,
    /** ISO `YYYY-MM` start of that review's period; null exactly when [lastReviewId] is null. */
    val lastReviewPeriodStartMonth: String? = null,
    /** ISO `YYYY-MM` end of that review's period; null exactly when [lastReviewId] is null. */
    val lastReviewPeriodEndMonth: String? = null,
    /** That review's status; null exactly when [lastReviewId] is null. */
    val lastReviewStatus: PerformanceReviewStatus? = null,
    // The row user's career profile (v1.32.1), resolved from the dictionaries at read time.
    // Path/specialization populate for EVERY view (unlike the directional stats above);
    // seniority is PRIVATE since v2.25.0 — populated only on view=managed (chain rows by
    // construction), for an HR caller, or on the caller's own row; null elsewhere means
    // "hidden", while on those rows null = the field is unset.
    val careerPath: DictionaryEntry? = null,
    val careerSpecialization: DictionaryEntry? = null,
    val seniorityLevel: DictionaryEntry? = null,
    // Days-off card stats (v1.44.0).
    /**
     * ISO start date of the row user's next ACCEPTED vacation that hasn't ended yet (ongoing
     * counts; pending never shows). Populated for view=managed and view=member — teammates see
     * accepted absences by calendar parity; null on view=managers (a manager's requests aren't
     * generally visible to their reports) and when nothing is planned.
     */
    val nextVacationStart: String? = null,
    /**
     * The row user's remaining paid-days budget for the current calendar year (carry-over and
     * corrections included). Populated ONLY for view=managed — budgets are manager/self-scoped,
     * so peer and manager rows never carry it.
     */
    val daysOffRemaining: Double? = null,
)

typealias TeamMemberPageResponse = PageResponse<TeamMemberListItem>
