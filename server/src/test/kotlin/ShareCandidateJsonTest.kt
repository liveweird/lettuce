package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffShareCandidateList
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.reviews.ShareCandidate
import ch.nokillswit.reviews.ShareCandidateList
import ch.nokillswit.reviews.ShareCandidateReason
import ch.nokillswit.teams.ChainPerson
import ch.nokillswit.teams.TeamRef
import ch.nokillswit.users.UserRef
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Pure (no app, no DB) pin of the share-candidate wire shape after the checkup #38 M7 consolidation:
 * both pickers' rows are the shared [ChainPerson]'s nine fields, FLAT and in the original order, and
 * the reviews row appends `review`/`shareable`/`reason` — byte-identical to the pre-consolidation
 * flat DTOs (default `Json`, the ContentNegotiation configuration: nulls are written).
 */
class ShareCandidateJsonTest {
    private val json = Json

    private val person = ChainPerson(
        userId = 7u,
        name = "Pat",
        email = "pat@example.com",
        deactivated = false,
        teams = listOf(TeamRef(3u, "Squad")),
        directManagers = listOf(UserRef(2u, "Boss")),
        careerPath = DictionaryEntry(1u, mapOf("en" to "Eng")),
        careerSpecialization = null,
        seniorityLevel = null,
    )

    private val personJson =
        """"userId":7,"name":"Pat","email":"pat@example.com","deactivated":false,""" +
            """"teams":[{"id":3,"name":"Squad"}],"directManagers":[{"id":2,"name":"Boss"}],""" +
            """"careerPath":{"id":1,"values":{"en":"Eng"}},"careerSpecialization":null,"seniorityLevel":null"""

    @Test
    fun `days-off candidates serialize the nine person fields flat, in order`() {
        assertEquals("""{"items":[{$personJson}]}""", json.encodeToString(DaysOffShareCandidateList(listOf(person))))
    }

    @Test
    fun `review candidates flatten the person and append review, shareable and reason`() {
        val list = ShareCandidateList(
            periodId = 4u,
            items = listOf(ShareCandidate(person, review = null, shareable = false, reason = ShareCandidateReason.NO_REVIEW)),
        )
        val expected =
            """{"periodId":4,"items":[{$personJson,"review":null,"shareable":false,"reason":"NO_REVIEW"}]}"""
        val encoded = json.encodeToString(list)
        assertEquals(expected, encoded)
        // The flat wire form decodes back into the nested model.
        assertEquals(list, json.decodeFromString<ShareCandidateList>(encoded))
    }
}
