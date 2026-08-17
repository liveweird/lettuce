package ch.nokillswit

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.dictionaries.DictionaryEntryInput
import ch.nokillswit.dictionaries.DictionaryEntryList
import ch.nokillswit.dictionaries.DictionaryUpdateRequest
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * Dictionaries are global singletons, so tests can't scope by unique prefixes the way list
 * features do — instead each test relies on the whole-document PUT semantics: putting a
 * complete payload resets the dictionary to exactly that state (leftovers from earlier tests
 * are soft-deleted by the replace itself), so every assertion is deterministic.
 */
class DictionaryTest {

    private fun uniqueValue(prefix: String) = "$prefix-${UUID.randomUUID()}"

    /** Payload item: EN required, PL rides along only when the test cares about translations. */
    private fun input(en: String, pl: String? = null, id: UInt? = null) = DictionaryEntryInput(
        id = id,
        values = buildMap {
            put("en", en)
            if (pl != null) put("pl", pl)
        },
    )

    private val DictionaryEntry.en: String get() = values.getValue("en")

    private suspend fun HttpClient.putDictionary(
        slug: String,
        vararg items: DictionaryEntryInput,
    ) = put("/api/v1/dictionaries/$slug") {
        contentType(ContentType.Application.Json)
        setBody(DictionaryUpdateRequest(items = items.toList()))
    }

    private suspend fun HttpClient.readDictionary(slug: String): DictionaryEntryList =
        get("/api/v1/dictionaries/$slug").body()

    @Test
    fun `unauthenticated requests return 401`() = testApplication {
        usePostgresTestcontainer()
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/dictionaries/career-paths").status)
        assertEquals(
            HttpStatusCode.Unauthorized,
            jsonClient().putDictionary("career-paths", input("x")).status,
        )
    }

    @Test
    fun `non-admin may read but not write - uniformly 403 even on an unknown slug`() = testApplication {
        usePostgresTestcontainer()
        val userEmail = uniqueEmail("user")
        TestUsers.seed(email = userEmail, password = "pw", roles = emptySet())
        val client = authedClient(userEmail, "pw")

        assertEquals(HttpStatusCode.OK, client.get("/api/v1/dictionaries/seniority-levels").status)
        assertEquals(
            HttpStatusCode.Forbidden,
            client.putDictionary("seniority-levels", input("x")).status,
        )
        // The admin guard runs before slug resolution: no existence signal for non-admins.
        assertEquals(
            HttpStatusCode.Forbidden,
            client.putDictionary("no-such-dictionary", input("x")).status,
        )
    }

    @Test
    fun `unknown slug is 404 for authenticated readers and admin writers`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/dictionaries/no-such-dictionary").status)
        assertEquals(
            HttpStatusCode.NotFound,
            client.putDictionary("no-such-dictionary", input("x")).status,
        )
    }

    @Test
    fun `replace inserts in payload order, reorders keeping ids, and renames in place`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val (a, b, c) = Triple(uniqueValue("Alpha"), uniqueValue("Beta"), uniqueValue("Gamma"))
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", input(a), input(b), input(c)).status,
        )
        val initial = client.readDictionary("career-paths").items
        assertEquals(listOf(a, b, c), initial.map { it.en })

        // Reorder only: same ids, new order.
        val reversed = initial.reversed().map { DictionaryEntryInput(id = it.id, values = it.values) }
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", *reversed.toTypedArray()).status,
        )
        val reordered = client.readDictionary("career-paths").items
        assertEquals(listOf(c, b, a), reordered.map { it.en })
        assertEquals(initial.map { it.id }.toSet(), reordered.map { it.id }.toSet())

        // Rename in place: the id survives the value change.
        val renamed = uniqueValue("Gamma-renamed")
        val edited = reordered.map {
            if (it.en == c) input(renamed, id = it.id)
            else DictionaryEntryInput(id = it.id, values = it.values)
        }
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", *edited.toTypedArray()).status,
        )
        val afterRename = client.readDictionary("career-paths").items
        assertEquals(listOf(renamed, b, a), afterRename.map { it.en })
        assertEquals(reordered.map { it.id }, afterRename.map { it.id })
    }

    @Test
    fun `an omitted entry is soft-deleted - flagged, never physically removed`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val keep = uniqueValue("Keep")
        val drop = uniqueValue("Drop")
        client.putDictionary("career-specializations", input(keep), input(drop))
        val entries = client.readDictionary("career-specializations").items
        val dropId = entries.first { it.en == drop }.id
        val keepInput = entries.first { it.en == keep }
            .let { DictionaryEntryInput(id = it.id, values = it.values) }

        assertEquals(HttpStatusCode.NoContent, client.putDictionary("career-specializations", keepInput).status)
        assertEquals(listOf(keep), client.readDictionary("career-specializations").items.map { it.en })

        val raw = TestDictionaries.rawRows(Dictionary.CAREER_SPECIALIZATION)
        val dropRow = raw.single { it.id == dropId }
        assertEquals(drop, dropRow.valueEn)
        assertTrue(dropRow.markedAsDeleted, "omitted entry must be soft-deleted, not hard-deleted")
    }

    @Test
    fun `duplicate, foreign and soft-deleted payload ids are 400`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        client.putDictionary("career-paths", input(uniqueValue("Path")))
        val pathId = client.readDictionary("career-paths").items.single().id

        // Duplicate id in one payload.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary(
                "career-paths",
                input(uniqueValue("One"), id = pathId),
                input(uniqueValue("Two"), id = pathId),
            ).status,
        )
        // Foreign id: an id belonging to ANOTHER dictionary is unknown here.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary("seniority-levels", input(uniqueValue("Sen"), id = pathId)).status,
        )
        // A soft-deleted entry's id can never be resubmitted (no resurrection).
        assertEquals(HttpStatusCode.NoContent, client.putDictionary("career-paths").status)
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary("career-paths", input(uniqueValue("Back"), id = pathId)).status,
        )
    }

    @Test
    fun `values are trimmed and payload duplicates rejected after trimming`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val v = uniqueValue("Trimmed")
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", input("  $v  ", pl = "  $v-pl  ")).status,
        )
        assertEquals(
            listOf(mapOf("en" to v, "pl" to "$v-pl")),
            client.readDictionary("career-paths").items.map { it.values },
        )

        // "X" and " X" are the same value once trimmed → duplicate → 400.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary("career-paths", input(v), input(" $v")).status,
        )
        // Blank and whitespace-only are rejected.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary("career-paths", input("   ")).status,
        )
    }

    @Test
    fun `only English is required - a missing or blank en value is 400, a present blank translation too`() =
        testApplication {
            usePostgresTestcontainer()
            val adminEmail = uniqueEmail("admin")
            TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
            val client = authedClient(adminEmail, "pw")

            // No 'en' key at all.
            assertEquals(
                HttpStatusCode.BadRequest,
                client.putDictionary(
                    "career-paths",
                    DictionaryEntryInput(values = mapOf("pl" to uniqueValue("OnlyPl"))),
                ).status,
            )
            // A PRESENT blank translation is a 400 (omit the language to clear it), so
            // "empty means clear" typos never silently drop data.
            assertEquals(
                HttpStatusCode.BadRequest,
                client.putDictionary("career-paths", input(uniqueValue("BlankPl"), pl = "   ")).status,
            )
            // An EN-only entry is fine and reads back as a one-key map — no phantom languages.
            val enOnly = uniqueValue("EnOnly")
            assertEquals(HttpStatusCode.NoContent, client.putDictionary("career-paths", input(enOnly)).status)
            assertEquals(
                mapOf("en" to enOnly),
                client.readDictionary("career-paths").items.single().values,
            )
        }

    @Test
    fun `an unsupported language code is 400`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val response = client.putDictionary(
            "career-paths",
            DictionaryEntryInput(values = mapOf("en" to uniqueValue("Lang"), "de" to "Sprache")),
        )
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertTrue("Unsupported language" in response.body<ProblemDetail>().detail.orEmpty())
    }

    @Test
    fun `value length and entry count limits`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary("career-paths", input("x".repeat(101))).status,
        )
        // The translation map has no DB column cap — the validation limit applies per language.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary("career-paths", input(uniqueValue("LongPl"), pl = "x".repeat(101))).status,
        )
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", input("y".repeat(100), pl = "z".repeat(100))).status,
        )

        val cap = (1..200).map { input("Entry $it") }
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("seniority-levels", *cap.toTypedArray()).status,
        )
        val overCap = cap + input("Entry 201")
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary("seniority-levels", *overCap.toTypedArray()).status,
        )
    }

    @Test
    fun `an empty payload clears the dictionary`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        client.putDictionary("career-specializations", input(uniqueValue("Gone")))
        assertEquals(HttpStatusCode.NoContent, client.putDictionary("career-specializations").status)
        assertEquals(emptyList(), client.readDictionary("career-specializations").items)
    }

    @Test
    fun `a soft-deleted value is reusable and re-adding mints a new id`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val junior = uniqueValue("Junior")
        client.putDictionary("seniority-levels", input(junior))
        val firstId = client.readDictionary("seniority-levels").items.single().id

        // Later PUT re-adds the value after it was removed.
        client.putDictionary("seniority-levels")
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("seniority-levels", input(junior)).status,
        )
        val secondId = client.readDictionary("seniority-levels").items.single().id
        assertNotEquals(firstId, secondId, "re-adding a removed value must mint a new entry")

        // Remove + re-add the same value in ONE save: the delete-first ordering frees the value.
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("seniority-levels", input(junior)).status,
        )
        val thirdId = client.readDictionary("seniority-levels").items.single().id
        assertNotEquals(secondId, thirdId)
    }

    @Test
    fun `the same value may live in two dictionaries at once`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val shared = uniqueValue("Shared")
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", input(shared)).status,
        )
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-specializations", input(shared)).status,
        )
        assertEquals(listOf(shared), client.readDictionary("career-paths").items.map { it.en })
        assertEquals(listOf(shared), client.readDictionary("career-specializations").items.map { it.en })
    }

    @Test
    fun `swapping two English values in one save is 409 - the documented limitation`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val (a, b) = uniqueValue("SwapA") to uniqueValue("SwapB")
        client.putDictionary("career-paths", input(a), input(b))
        val entries = client.readDictionary("career-paths").items

        // The EN column keeps its per-statement partial unique index (the DB backstop for
        // the default language), so an in-place EN swap still trips it mid-save.
        val swapped = client.putDictionary(
            "career-paths",
            input(b, id = entries[0].id),
            input(a, id = entries[1].id),
        )
        assertEquals(HttpStatusCode.Conflict, swapped.status)
    }

    @Test
    fun `swapping two translations in one save succeeds - only English keeps the index limitation`() =
        testApplication {
            usePostgresTestcontainer()
            val adminEmail = uniqueEmail("admin")
            TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
            val client = authedClient(adminEmail, "pw")

            val (a, b) = uniqueValue("TrSwapA") to uniqueValue("TrSwapB")
            client.putDictionary("career-paths", input(a, pl = "$a-pl"), input(b, pl = "$b-pl"))
            val entries = client.readDictionary("career-paths").items

            // Non-EN uniqueness is payload-level validation only — a whole-document swap is
            // internally consistent, so it saves in one go (no index to trip).
            assertEquals(
                HttpStatusCode.NoContent,
                client.putDictionary(
                    "career-paths",
                    input(a, pl = "$b-pl", id = entries[0].id),
                    input(b, pl = "$a-pl", id = entries[1].id),
                ).status,
            )
            val after = client.readDictionary("career-paths").items
            assertEquals(listOf("$b-pl", "$a-pl"), after.map { it.values.getValue("pl") })
        }

    @Test
    fun `value uniqueness is case-sensitive`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val suffix = UUID.randomUUID().toString()
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary(
                "seniority-levels",
                input("Senior-$suffix"),
                input("senior-$suffix"),
            ).status,
        )
        assertEquals(2, client.readDictionary("seniority-levels").items.size)
    }

    @Test
    fun `uniqueness is per language - a Polish duplicate is 400 while a cross-language match is fine`() =
        testApplication {
            usePostgresTestcontainer()
            val adminEmail = uniqueEmail("admin")
            TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
            val client = authedClient(adminEmail, "pw")

            val (en1, en2) = uniqueValue("Bi-A") to uniqueValue("Bi-B")
            val pl = uniqueValue("Bi-PL")
            // Two rows sharing a POLISH value → 400, even though the English side is unique.
            assertEquals(
                HttpStatusCode.BadRequest,
                client.putDictionary("career-paths", input(en1, pl = pl), input(en2, pl = pl)).status,
            )
            // One row's English matching ANOTHER row's Polish is fine — uniqueness is per language.
            assertEquals(
                HttpStatusCode.NoContent,
                client.putDictionary("career-paths", input(en1, pl = pl), input(pl, pl = en2)).status,
            )
            val items = client.readDictionary("career-paths").items
            assertEquals(
                listOf(mapOf("en" to en1, "pl" to pl), mapOf("en" to pl, "pl" to en2)),
                items.map { it.values },
            )
        }

    @Test
    fun `a translation-only change keeps the id, and omitting the language clears it`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val en = uniqueValue("TrOnly")
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", input(en, pl = "$en-pl")).status,
        )
        val entry = client.readDictionary("career-paths").items.single()

        val renamedPl = "$en-pl-renamed"
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", input(en, pl = renamedPl, id = entry.id)).status,
        )
        val after = client.readDictionary("career-paths").items.single()
        assertEquals(entry.id, after.id)
        assertEquals(mapOf("en" to en, "pl" to renamedPl), after.values)

        // Resubmitting without the language clears the translation (identity kept).
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", input(en, id = entry.id)).status,
        )
        val cleared = client.readDictionary("career-paths").items.single()
        assertEquals(entry.id, cleared.id)
        assertFalse("pl" in cleared.values, "an omitted language must clear its translation")
    }
}
