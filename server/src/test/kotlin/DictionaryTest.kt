package ch.nokillswit

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntryInput
import ch.nokillswit.dictionaries.DictionaryEntryList
import ch.nokillswit.dictionaries.DictionaryUpdateRequest
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
            jsonClient().putDictionary("career-paths", DictionaryEntryInput(valueEn = "x", valuePl = "x")).status,
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
            client.putDictionary("seniority-levels", DictionaryEntryInput(valueEn = "x", valuePl = "x")).status,
        )
        // The admin guard runs before slug resolution: no existence signal for non-admins.
        assertEquals(
            HttpStatusCode.Forbidden,
            client.putDictionary("no-such-dictionary", DictionaryEntryInput(valueEn = "x", valuePl = "x")).status,
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
            client.putDictionary("no-such-dictionary", DictionaryEntryInput(valueEn = "x", valuePl = "x")).status,
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
            client.putDictionary(
                "career-paths",
                DictionaryEntryInput(valueEn = a, valuePl = a),
                DictionaryEntryInput(valueEn = b, valuePl = b),
                DictionaryEntryInput(valueEn = c, valuePl = c),
            ).status,
        )
        val initial = client.readDictionary("career-paths").items
        assertEquals(listOf(a, b, c), initial.map { it.valueEn })

        // Reorder only: same ids, new order.
        val reversed = initial.reversed().map { DictionaryEntryInput(id = it.id, valueEn = it.valueEn, valuePl = it.valuePl) }
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", *reversed.toTypedArray()).status,
        )
        val reordered = client.readDictionary("career-paths").items
        assertEquals(listOf(c, b, a), reordered.map { it.valueEn })
        assertEquals(initial.map { it.id }.toSet(), reordered.map { it.id }.toSet())

        // Rename in place: the id survives the value change.
        val renamed = uniqueValue("Gamma-renamed")
        val edited = reordered.map {
            if (it.valueEn == c) DictionaryEntryInput(id = it.id, valueEn = renamed, valuePl = renamed)
            else DictionaryEntryInput(id = it.id, valueEn = it.valueEn, valuePl = it.valuePl)
        }
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", *edited.toTypedArray()).status,
        )
        val afterRename = client.readDictionary("career-paths").items
        assertEquals(listOf(renamed, b, a), afterRename.map { it.valueEn })
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
        client.putDictionary(
            "career-specializations",
            DictionaryEntryInput(valueEn = keep, valuePl = keep),
            DictionaryEntryInput(valueEn = drop, valuePl = drop),
        )
        val entries = client.readDictionary("career-specializations").items
        val dropId = entries.first { it.valueEn == drop }.id
        val keepInput = entries.first { it.valueEn == keep }.let { DictionaryEntryInput(id = it.id, valueEn = it.valueEn, valuePl = it.valuePl) }

        assertEquals(HttpStatusCode.NoContent, client.putDictionary("career-specializations", keepInput).status)
        assertEquals(listOf(keep), client.readDictionary("career-specializations").items.map { it.valueEn })

        val raw = TestDictionaries.rawRows(Dictionary.CAREER_SPECIALIZATION)
        val dropRow = raw.single { it.id == dropId }
        assertEquals(drop, dropRow.value)
        assertTrue(dropRow.markedAsDeleted, "omitted entry must be soft-deleted, not hard-deleted")
    }

    @Test
    fun `duplicate, foreign and soft-deleted payload ids are 400`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        client.putDictionary("career-paths", DictionaryEntryInput(valueEn = uniqueValue("Path"), valuePl = uniqueValue("Path")))
        val pathId = client.readDictionary("career-paths").items.single().id

        // Duplicate id in one payload.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary(
                "career-paths",
                DictionaryEntryInput(id = pathId, valueEn = uniqueValue("One"), valuePl = uniqueValue("One")),
                DictionaryEntryInput(id = pathId, valueEn = uniqueValue("Two"), valuePl = uniqueValue("Two")),
            ).status,
        )
        // Foreign id: an id belonging to ANOTHER dictionary is unknown here.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary(
                "seniority-levels",
                DictionaryEntryInput(id = pathId, valueEn = uniqueValue("Sen"), valuePl = uniqueValue("Sen")),
            ).status,
        )
        // A soft-deleted entry's id can never be resubmitted (no resurrection).
        assertEquals(HttpStatusCode.NoContent, client.putDictionary("career-paths").status)
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary(
                "career-paths",
                DictionaryEntryInput(id = pathId, valueEn = uniqueValue("Back"), valuePl = uniqueValue("Back")),
            ).status,
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
            client.putDictionary("career-paths", DictionaryEntryInput(valueEn = "  $v  ", valuePl = "  $v  ")).status,
        )
        assertEquals(listOf(v), client.readDictionary("career-paths").items.map { it.valueEn })

        // "X" and " X" are the same value once trimmed → duplicate → 400.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary(
                "career-paths",
                DictionaryEntryInput(valueEn = v, valuePl = v),
                DictionaryEntryInput(valueEn = " $v", valuePl = " $v"),
            ).status,
        )
        // Blank and whitespace-only are rejected.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary("career-paths", DictionaryEntryInput(valueEn = "   ", valuePl = "   ")).status,
        )
    }

    @Test
    fun `value length and entry count limits`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        assertEquals(
            HttpStatusCode.BadRequest,
            client.putDictionary("career-paths", DictionaryEntryInput(valueEn = "x".repeat(101), valuePl = "x".repeat(101))).status,
        )
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", DictionaryEntryInput(valueEn = "y".repeat(100), valuePl = "y".repeat(100))).status,
        )

        val cap = (1..200).map { DictionaryEntryInput(valueEn = "Entry $it", valuePl = "Entry $it") }
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("seniority-levels", *cap.toTypedArray()).status,
        )
        val overCap = cap + DictionaryEntryInput(valueEn = "Entry 201", valuePl = "Entry 201")
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

        client.putDictionary("career-specializations", DictionaryEntryInput(valueEn = uniqueValue("Gone"), valuePl = uniqueValue("Gone")))
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
        client.putDictionary("seniority-levels", DictionaryEntryInput(valueEn = junior, valuePl = junior))
        val firstId = client.readDictionary("seniority-levels").items.single().id

        // Later PUT re-adds the value after it was removed.
        client.putDictionary("seniority-levels")
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("seniority-levels", DictionaryEntryInput(valueEn = junior, valuePl = junior)).status,
        )
        val secondId = client.readDictionary("seniority-levels").items.single().id
        assertNotEquals(firstId, secondId, "re-adding a removed value must mint a new entry")

        // Remove + re-add the same value in ONE save: the delete-first ordering frees the value.
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("seniority-levels", DictionaryEntryInput(valueEn = junior, valuePl = junior)).status,
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
            client.putDictionary("career-paths", DictionaryEntryInput(valueEn = shared, valuePl = shared)).status,
        )
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-specializations", DictionaryEntryInput(valueEn = shared, valuePl = shared)).status,
        )
        assertEquals(listOf(shared), client.readDictionary("career-paths").items.map { it.valueEn })
        assertEquals(listOf(shared), client.readDictionary("career-specializations").items.map { it.valueEn })
    }

    @Test
    fun `swapping two values in one save is 409 - the documented limitation`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val (a, b) = uniqueValue("SwapA") to uniqueValue("SwapB")
        client.putDictionary("career-paths", DictionaryEntryInput(valueEn = a, valuePl = a), DictionaryEntryInput(valueEn = b, valuePl = b))
        val entries = client.readDictionary("career-paths").items

        val swapped = client.putDictionary(
            "career-paths",
            DictionaryEntryInput(id = entries[0].id, valueEn = b, valuePl = b),
            DictionaryEntryInput(id = entries[1].id, valueEn = a, valuePl = a),
        )
        assertEquals(HttpStatusCode.Conflict, swapped.status)
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
                DictionaryEntryInput(valueEn = "Senior-$suffix", valuePl = "Senior-$suffix"),
                DictionaryEntryInput(valueEn = "senior-$suffix", valuePl = "senior-$suffix"),
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
                client.putDictionary(
                    "career-paths",
                    DictionaryEntryInput(valueEn = en1, valuePl = pl),
                    DictionaryEntryInput(valueEn = en2, valuePl = pl),
                ).status,
            )
            // One row's English matching ANOTHER row's Polish is fine — uniqueness is per column.
            assertEquals(
                HttpStatusCode.NoContent,
                client.putDictionary(
                    "career-paths",
                    DictionaryEntryInput(valueEn = en1, valuePl = pl),
                    DictionaryEntryInput(valueEn = pl, valuePl = en2),
                ).status,
            )
            val items = client.readDictionary("career-paths").items
            assertEquals(listOf(en1 to pl, pl to en2), items.map { it.valueEn to it.valuePl })
        }

    @Test
    fun `a Polish-only rename keeps the id and counts as a rename`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw")

        val en = uniqueValue("PlOnly")
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary("career-paths", DictionaryEntryInput(valueEn = en, valuePl = "$en-pl")).status,
        )
        val entry = client.readDictionary("career-paths").items.single()

        val renamedPl = "$en-pl-renamed"
        assertEquals(
            HttpStatusCode.NoContent,
            client.putDictionary(
                "career-paths",
                DictionaryEntryInput(id = entry.id, valueEn = en, valuePl = renamedPl),
            ).status,
        )
        val after = client.readDictionary("career-paths").items.single()
        assertEquals(entry.id, after.id)
        assertEquals(en, after.valueEn)
        assertEquals(renamedPl, after.valuePl)
    }
}
