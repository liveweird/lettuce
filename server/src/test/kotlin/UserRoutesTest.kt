package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamResponse
import ch.nokillswit.users.PasswordUpdateRequest
import ch.nokillswit.users.UserCreateResponse
import ch.nokillswit.users.UserPageResponse
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserUpdateRequest
import ch.nokillswit.users.UserResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.patch
import io.ktor.client.request.put
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class UserRoutesTest {


    @Test
    fun `POST users creates and returns 201 with Location`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val client = authedClient(callerEmail, "pw-123456789")
        val newEmail = uniqueEmail("created")
        val response = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Alice", email = newEmail, password = "secret-123456"))
        }

        assertEquals(HttpStatusCode.Created, response.status)
        val body = response.body<UserResponse>()
        assertEquals("Alice", body.name)
        assertEquals(newEmail, body.email)
        val location = response.headers[HttpHeaders.Location]
        assertNotNull(location)
        assertTrue(location.endsWith("/api/v1/users/${body.id}"), "Location was $location")
    }

    @Test
    fun `GET users id round-trips a freshly created user`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val client = authedClient(callerEmail, "pw-123456789")
        val newEmail = uniqueEmail("bob")
        val created = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Bob", email = newEmail, password = "pw-123456789"))
        }.body<UserResponse>()

        val read = client.get("/api/v1/users/${created.id}")
        assertEquals(HttpStatusCode.OK, read.status)
        assertEquals(created, read.body<UserResponse>())
    }

    @Test
    fun `GET users id on nonexistent id returns 404`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val response = authedClient(callerEmail, "pw-123456789").get("/api/v1/users/999999")
        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    @Test
    fun `PUT users id updates name and email`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val client = authedClient(callerEmail, "pw-123456789")
        val originalEmail = uniqueEmail("orig")
        val created = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Old", email = originalEmail, password = "pw-123456789"))
        }.body<UserResponse>()

        val updatedEmail = uniqueEmail("upd")
        val put = client.put("/api/v1/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest(name = "New", email = updatedEmail, roles = emptyList()))
        }
        assertEquals(HttpStatusCode.NoContent, put.status)

        val read = client.get("/api/v1/users/${created.id}").body<UserResponse>()
        assertEquals("New", read.name)
        assertEquals(updatedEmail, read.email)
    }

    @Test
    fun `PUT users id preserves the password so login still works`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val client = authedClient(callerEmail, "pw-123456789")
        val originalPassword = "horse-battery-staple"
        val originalEmail = uniqueEmail("pwd")
        val created = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Pat", email = originalEmail, password = originalPassword))
        }.body<UserResponse>()

        val newEmail = uniqueEmail("pwd-renamed")
        val put = client.put("/api/v1/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest(name = "Patrick", email = newEmail, roles = emptyList()))
        }
        assertEquals(HttpStatusCode.NoContent, put.status)

        val login = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(newEmail, originalPassword))
        }
        assertEquals(HttpStatusCode.OK, login.status)
        assertTrue(login.body<LoginResponse>().token.isNotBlank())
    }

    @Test
    fun `PUT users id password changes the password so login uses the new one`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))

        val client = authedClient(adminEmail, "pw-123456789")
        val userEmail = uniqueEmail("pwd")
        val created = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Pat", email = userEmail, password = "old-password"))
        }.body<UserResponse>()

        val put = client.put("/api/v1/users/${created.id}/password") {
            contentType(ContentType.Application.Json)
            setBody(PasswordUpdateRequest(password = "brand-new-password"))
        }
        assertEquals(HttpStatusCode.NoContent, put.status)

        val withNew = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(userEmail, "brand-new-password"))
        }
        assertEquals(HttpStatusCode.OK, withNew.status)
        assertTrue(withNew.body<LoginResponse>().token.isNotBlank())

        val withOld = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(userEmail, "old-password"))
        }
        assertEquals(HttpStatusCode.Unauthorized, withOld.status)
    }

    @Test
    fun `PUT users id password forbids a non-admin changing another user's password`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789", roles = emptySet())
        val targetId = TestUsers.seed(
            email = uniqueEmail("target"),
            password = "pw-123456789",
            roles = emptySet(),
        )

        val response = authedClient(callerEmail, "pw-123456789").put("/api/v1/users/$targetId/password") {
            contentType(ContentType.Application.Json)
            setBody(PasswordUpdateRequest(password = "should-not-apply"))
        }
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `PUT users id lets admin change another user's role`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val targetId = TestUsers.seed(
            email = uniqueEmail("target"),
            password = "pw-123456789",
            roles = emptySet(),
        )

        val client = authedClient(adminEmail, "pw-123456789")
        val read = client.get("/api/v1/users/$targetId").body<UserResponse>()
        assertEquals(emptyList(), read.roles)

        val put = client.put("/api/v1/users/$targetId") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest(name = read.name, email = read.email, roles = listOf(UserRole.ADMIN)))
        }
        assertEquals(HttpStatusCode.NoContent, put.status)

        val after = client.get("/api/v1/users/$targetId").body<UserResponse>()
        assertEquals(listOf(UserRole.ADMIN), after.roles)
    }

    @Test
    fun `PUT users id on nonexistent id returns 404`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val response = authedClient(callerEmail, "pw-123456789").put("/api/v1/users/999999") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest(name = "Ghost", email = uniqueEmail("ghost"), roles = emptyList()))
        }
        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    @Test
    fun `DELETE users id removes the user`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val client = authedClient(callerEmail, "pw-123456789")
        val created = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Doomed", email = uniqueEmail("doomed"), password = "pw-123456789"))
        }.body<UserResponse>()

        val delete = client.delete("/api/v1/users/${created.id}")
        assertEquals(HttpStatusCode.NoContent, delete.status)

        val read = client.get("/api/v1/users/${created.id}")
        assertEquals(HttpStatusCode.NotFound, read.status)
    }

    @Test
    fun `DELETE users id hides the user from listings`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val client = authedClient(callerEmail, "pw-123456789")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val keeper = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "keep-$tag", email = uniqueEmail("keep-$tag"), password = "pw-123456789"))
        }.body<UserResponse>()
        val doomed = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "drop-$tag", email = uniqueEmail("drop-$tag"), password = "pw-123456789"))
        }.body<UserResponse>()

        val before = client.get("/api/v1/users?name=$tag").body<UserPageResponse>()
        assertEquals(2L, before.total)

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/users/${doomed.id}").status)

        val after = client.get("/api/v1/users?name=$tag").body<UserPageResponse>()
        assertEquals(1L, after.total)
        assertEquals(keeper.id, after.items.single().id)
    }

    @Test
    fun `DELETE users id prevents the deleted user from logging in`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val client = authedClient(callerEmail, "pw-123456789")
        val victimEmail = uniqueEmail("victim")
        val victim = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Victim", email = victimEmail, password = "secret-123456"))
        }.body<UserResponse>()

        val loginBefore = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(victimEmail, "secret-123456"))
        }
        assertEquals(HttpStatusCode.OK, loginBefore.status)

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/users/${victim.id}").status)

        val loginAfter = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(victimEmail, "secret-123456"))
        }
        assertEquals(HttpStatusCode.Unauthorized, loginAfter.status)
    }

    @Test
    fun `PUT users id on a soft-deleted user returns 404`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val client = authedClient(callerEmail, "pw-123456789")
        val created = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Ghost", email = uniqueEmail("ghost"), password = "pw-123456789"))
        }.body<UserResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/users/${created.id}").status)

        val put = client.put("/api/v1/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest(name = "Resurrected", email = uniqueEmail("res"), roles = emptyList()))
        }
        assertEquals(HttpStatusCode.NotFound, put.status)
    }

    @Test
    fun `DELETE users id returns 404 once the user is already gone`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val client = authedClient(callerEmail, "pw-123456789")
        val created = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Twice", email = uniqueEmail("twice"), password = "pw-123456789"))
        }.body<UserResponse>()

        // First delete soft-deletes the row; a second delete finds nothing → 404.
        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/users/${created.id}").status)
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/users/${created.id}").status)
    }

    @Test
    fun `DELETE users id returns 404 for a non-existent user`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val client = authedClient(callerEmail, "pw-123456789")
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/users/999999").status)
    }

    @Test
    fun `user endpoints require authentication`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val endpoints = listOf(
            HttpMethod.Post to "/api/v1/users",
            HttpMethod.Get to "/api/v1/users/1",
            HttpMethod.Put to "/api/v1/users/1",
            HttpMethod.Delete to "/api/v1/users/1",
        )
        for ((verb, path) in endpoints) {
            val response = client.request(path) { method = verb }
            assertEquals(
                HttpStatusCode.Unauthorized,
                response.status,
                "$verb $path expected 401, got ${response.status}",
            )
        }
    }

    @Test
    fun `POST users with duplicate email returns 409`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val client = authedClient(callerEmail, "pw-123456789")
        val sharedEmail = uniqueEmail("dup")
        val first = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "First", email = sharedEmail, password = "pw-123456789"))
        }
        assertEquals(HttpStatusCode.Created, first.status)

        val second = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Second", email = sharedEmail, password = "pw-123456789"))
        }
        assertEquals(HttpStatusCode.Conflict, second.status)
        assertEquals(HttpStatusCode.Conflict.value, second.body<ProblemDetail>().status)
    }

    @Test
    fun `a soft-deleted user's email can be reused`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw-123456789")

        val sharedEmail = uniqueEmail("reusable")
        val first = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "First", email = sharedEmail, password = "pw-123456789"))
        }.body<UserResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/users/${first.id}").status)

        // The partial unique index only constrains active rows, so the email is free again.
        val second = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Second", email = sharedEmail, password = "new-pw-123456"))
        }
        assertEquals(HttpStatusCode.Created, second.status)
        val recreated = second.body<UserResponse>()
        assertTrue(recreated.id != first.id)

        // Login resolves the new (active) account, since findWithIdByEmail filters on active().
        val login = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(sharedEmail, "new-pw-123456"))
        }
        assertEquals(HttpStatusCode.OK, login.status)
        assertEquals(recreated.id, login.body<LoginResponse>().userId)
    }

    @Test
    fun `PUT users id with email already used by another user returns 409`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val client = authedClient(callerEmail, "pw-123456789")
        val emailA = uniqueEmail("a")
        val emailB = uniqueEmail("b")
        client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "A", email = emailA, password = "pw-123456789"))
        }
        val userB = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "B", email = emailB, password = "pw-123456789"))
        }.body<UserResponse>()

        val response = client.put("/api/v1/users/${userB.id}") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest(name = "B", email = emailA, roles = emptyList()))
        }
        assertEquals(HttpStatusCode.Conflict, response.status)
        assertEquals(HttpStatusCode.Conflict.value, response.body<ProblemDetail>().status)
    }

    @Test
    fun `GET users returns paginated envelope with defaults`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val client = authedClient(callerEmail, "pw-123456789")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        repeat(3) { i ->
            client.post("/api/v1/users") {
                contentType(ContentType.Application.Json)
                setBody(UserRequest(name = "list-$tag-$i", email = uniqueEmail("list-$tag-$i"), password = "pw-123456789"))
            }
        }

        val response = client.get("/api/v1/users?name=list-$tag")
        assertEquals(HttpStatusCode.OK, response.status)
        val page = response.body<UserPageResponse>()
        assertEquals(1, page.page)
        assertEquals(20, page.pageSize)
        assertEquals(3L, page.total)
        assertEquals(3, page.items.size)
        assertEquals(listOf("list-$tag-0", "list-$tag-1", "list-$tag-2"), page.items.map { it.name })
    }

    @Test
    fun `GET users supports sort by name descending`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val client = authedClient(callerEmail, "pw-123456789")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        listOf("bravo", "alpha", "charlie").forEach { stem ->
            client.post("/api/v1/users") {
                contentType(ContentType.Application.Json)
                setBody(UserRequest(name = "sort-$tag-$stem", email = uniqueEmail("sort-$tag-$stem"), password = "pw-123456789"))
            }
        }

        val response = client.get("/api/v1/users?name=sort-$tag&sort=-name")
        assertEquals(HttpStatusCode.OK, response.status)
        val page = response.body<UserPageResponse>()
        assertEquals(listOf("sort-$tag-charlie", "sort-$tag-bravo", "sort-$tag-alpha"), page.items.map { it.name })
    }

    @Test
    fun `GET users supports name substring filter case-insensitive`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val client = authedClient(callerEmail, "pw-123456789")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Alicia-$tag", email = uniqueEmail("alicia-$tag"), password = "pw-123456789"))
        }
        client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Bob-$tag", email = uniqueEmail("bob-$tag"), password = "pw-123456789"))
        }

        val response = client.get("/api/v1/users?name=ALICIA-$tag")
        val page = response.body<UserPageResponse>()
        assertEquals(1L, page.total)
        assertEquals("Alicia-$tag", page.items.single().name)
    }

    @Test
    fun `GET users supports email substring filter`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val client = authedClient(callerEmail, "pw-123456789")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "X-$tag", email = "match-$tag@example.org", password = "pw-123456789"))
        }
        client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Y-$tag", email = "miss-$tag@other.org", password = "pw-123456789"))
        }

        val page = client.get("/api/v1/users?email=match-$tag").body<UserPageResponse>()
        assertEquals(1L, page.total)
        assertEquals("match-$tag@example.org", page.items.single().email)
    }

    @Test
    fun `GET users supports role filter`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val client = authedClient(callerEmail, "pw-123456789")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "role-$tag-admin", email = uniqueEmail("ra-$tag"), password = "pw-123456789", roles = listOf(UserRole.ADMIN)))
        }
        client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "role-$tag-user", email = uniqueEmail("ru-$tag"), password = "pw-123456789", roles = emptyList()))
        }

        val admins = client.get("/api/v1/users?name=role-$tag&role=ADMIN").body<UserPageResponse>()
        assertEquals(1L, admins.total)
        assertEquals(listOf(UserRole.ADMIN), admins.items.single().roles)

        // USER is implicit, never a stored role — as a filter value it is malformed.
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/users?name=role-$tag&role=USER").status)
    }

    @Test
    fun `GET users supports filter by teamId`() = testApplication {
        usePostgresTestcontainer()
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val callerEmail = uniqueEmail("admin-$tag")
        TestUsers.seed(email = callerEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN), name = "Admin-$tag")
        val managerId = TestUsers.seed(email = uniqueEmail("mgr-$tag"), password = "pw-123456789", name = "Mgr-$tag")
        val memberA = TestUsers.seed(email = uniqueEmail("a-$tag"), password = "pw-123456789", name = "MemberA-$tag")
        val memberB = TestUsers.seed(email = uniqueEmail("b-$tag"), password = "pw-123456789", name = "MemberB-$tag")
        TestUsers.seed(email = uniqueEmail("out-$tag"), password = "pw-123456789", name = "Outsider-$tag")

        val client = authedClient(callerEmail, "pw-123456789")
        val team = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "team-$tag", managerId = managerId, memberIds = listOf(memberA, memberB)))
        }.body<TeamResponse>()

        val page = client.get("/api/v1/users?teamId=${team.id}").body<UserPageResponse>()
        // Exactly the two members — manager (not a member), outsider, and caller are excluded.
        assertEquals(2L, page.total)
        assertEquals(setOf(memberA, memberB), page.items.map { it.id }.toSet())
    }

    @Test
    fun `GET users with non-numeric teamId returns 400`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val response = authedClient(callerEmail, "pw-123456789").get("/api/v1/users?teamId=abc")
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `GET users paginates correctly`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val client = authedClient(callerEmail, "pw-123456789")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        repeat(5) { i ->
            client.post("/api/v1/users") {
                contentType(ContentType.Application.Json)
                setBody(UserRequest(name = "page-$tag-$i", email = uniqueEmail("page-$tag-$i"), password = "pw-123456789"))
            }
        }

        val pageOne = client.get("/api/v1/users?name=page-$tag&sort=name&page=1&pageSize=2").body<UserPageResponse>()
        assertEquals(5L, pageOne.total)
        assertEquals(2, pageOne.items.size)
        assertEquals(listOf("page-$tag-0", "page-$tag-1"), pageOne.items.map { it.name })

        val pageTwo = client.get("/api/v1/users?name=page-$tag&sort=name&page=2&pageSize=2").body<UserPageResponse>()
        assertEquals(listOf("page-$tag-2", "page-$tag-3"), pageTwo.items.map { it.name })

        val pageThree = client.get("/api/v1/users?name=page-$tag&sort=name&page=3&pageSize=2").body<UserPageResponse>()
        assertEquals(listOf("page-$tag-4"), pageThree.items.map { it.name })
    }

    @Test
    fun `GET users with unknown sort field returns 400`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val response = authedClient(callerEmail, "pw-123456789").get("/api/v1/users?sort=passwordHash")
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals(HttpStatusCode.BadRequest.value, response.body<ProblemDetail>().status)
    }

    @Test
    fun `GET users with bogus role returns 400`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val response = authedClient(callerEmail, "pw-123456789").get("/api/v1/users?role=ROOT")
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals(HttpStatusCode.BadRequest.value, response.body<ProblemDetail>().status)
    }

    @Test
    fun `GET users no longer sorts by role`() = testApplication {
        // A roles set has no total order — `role` left the sortable whitelist with the V27 change.
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val response = authedClient(callerEmail, "pw-123456789").get("/api/v1/users?sort=role")
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `GET users with pageSize over max returns 400`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")
        val response = authedClient(callerEmail, "pw-123456789").get("/api/v1/users?pageSize=200")
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `GET users without authentication returns 401`() = testApplication {
        usePostgresTestcontainer()
        val response = jsonClient().get("/api/v1/users")
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `POST users stores hashed password verifiable via login`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw-123456789")

        val client = authedClient(callerEmail, "pw-123456789")
        val newEmail = uniqueEmail("login-me")
        val plainPassword = "correct-horse-battery-staple"
        client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Eve", email = newEmail, password = plainPassword))
        }

        val loginResponse = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(newEmail, plainPassword))
        }
        assertEquals(HttpStatusCode.OK, loginResponse.status)
        assertTrue(loginResponse.body<LoginResponse>().token.isNotBlank())
    }

    @Test
    fun `GET users applies name and role filters together`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw-123456789")

        // Shared name tag isolates this test's rows in the shared DB; roles differ so the
        // combined name+role filter must intersect, not just match one dimension.
        val tag = UUID.randomUUID().toString().take(8)
        val adminTargetEmail = uniqueEmail("a")
        client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "u-$tag", email = uniqueEmail("u"), password = "pw-123456789", roles = emptyList()))
        }
        client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "a-$tag", email = adminTargetEmail, password = "pw-123456789", roles = listOf(UserRole.ADMIN)))
        }

        // name=$tag alone matches both; role=ADMIN alone matches many; together → only the admin row.
        val page = client.get("/api/v1/users?name=$tag&role=ADMIN").body<UserPageResponse>()
        assertEquals(1, page.total)
        assertEquals(listOf(adminTargetEmail), page.items.map { it.email })
    }

    @Test
    fun `V27 backfill moved the seed roles into user_roles`() = testApplication {
        // The V6 admin and V9 demo users were inserted via the old users.role column; V27
        // migrates that column into the join table. Login responses read the new storage.
        usePostgresTestcontainer()
        val admin = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(ch.nokillswit.infra.db.SEED_ADMIN_EMAIL, "changeme"))
        }.body<LoginResponse>()
        assertEquals(listOf(UserRole.ADMIN), admin.roles)

        val demo = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(ch.nokillswit.infra.db.DEMO_SEED_EMAILS.first(), "changeme"))
        }.body<LoginResponse>()
        assertEquals(emptyList(), demo.roles)
    }

    @Test
    fun `service round-trips the roles set on create and wholesale-replaces it on update`() = testApplication {
        usePostgresTestcontainer()
        val service = TestServices.users
        val id = service.create(
            ch.nokillswit.users.User(
                name = "Roles Roundtrip",
                email = uniqueEmail("roundtrip"),
                passwordHash = "x",
                roles = setOf(UserRole.ADMIN),
            )
        )
        val created = service.read(id)
        assertNotNull(created)
        assertEquals(setOf(UserRole.ADMIN), created.roles)

        val updated = service.update(id, created.copy(roles = emptySet()))
        assertEquals(1, updated)
        assertEquals(emptySet(), service.read(id)?.roles)
    }

    // --- Career profile fields (v1.32.0) ---

    private suspend fun io.ktor.client.HttpClient.createPlainUser(prefix: String): UserResponse =
        post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Career $prefix", email = uniqueEmail(prefix), password = "pw-123456789"))
        }.body<UserResponse>()

    @Test
    fun `PUT sets career profile fields, GET resolves them, and null means leave unchanged`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("career-admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val client = authedClient(adminEmail, "pw-123456789")
        val created = client.createPlainUser("career-set")
        assertEquals(null, created.careerPath)
        assertEquals(null, created.careerSpecialization)
        assertEquals(null, created.seniorityLevel)

        val marker = UUID.randomUUID().toString().take(8)
        val (pathId) = TestDictionaries.append(Dictionary.CAREER_PATH, "Path $marker")
        val (specId) = TestDictionaries.append(Dictionary.CAREER_SPECIALIZATION, "Spec $marker")
        val (levelId) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "Level $marker")

        val put = client.put("/api/v1/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                UserUpdateRequest(
                    name = created.name, email = created.email, roles = emptyList(),
                    careerPathId = pathId, careerSpecializationId = specId, seniorityLevelId = levelId,
                ),
            )
        }
        assertEquals(HttpStatusCode.NoContent, put.status)

        val read = client.get("/api/v1/users/${created.id}").body<UserResponse>()
        assertEquals(DictionaryEntry(pathId, "Path $marker"), read.careerPath)
        assertEquals(DictionaryEntry(specId, "Spec $marker"), read.careerSpecialization)
        assertEquals(DictionaryEntry(levelId, "Level $marker"), read.seniorityLevel)

        // A follow-up PUT omitting the ids leaves them untouched — clearing is inexpressible.
        val nullPut = client.put("/api/v1/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest(name = created.name, email = created.email, roles = emptyList()))
        }
        assertEquals(HttpStatusCode.NoContent, nullPut.status)
        val reread = client.get("/api/v1/users/${created.id}").body<UserResponse>()
        assertEquals(read.careerPath, reread.careerPath)
        assertEquals(read.careerSpecialization, reread.careerSpecialization)
        assertEquals(read.seniorityLevel, reread.seniorityLevel)
    }

    @Test
    fun `dictionary renames propagate to user reads and lists`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("career-rename-admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val client = authedClient(adminEmail, "pw-123456789")
        val created = client.createPlainUser("career-rename")

        val marker = UUID.randomUUID().toString().take(8)
        val (pathId) = TestDictionaries.append(Dictionary.CAREER_PATH, "AAA $marker")
        client.put("/api/v1/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                UserUpdateRequest(
                    name = created.name, email = created.email, roles = emptyList(),
                    careerPathId = pathId,
                ),
            )
        }.let { assertEquals(HttpStatusCode.NoContent, it.status) }

        TestDictionaries.rename(Dictionary.CAREER_PATH, pathId, "AAA1 $marker")

        val read = client.get("/api/v1/users/${created.id}").body<UserResponse>()
        assertEquals(DictionaryEntry(pathId, "AAA1 $marker"), read.careerPath)

        val page = client.get("/api/v1/users?email=${created.email}").body<UserPageResponse>()
        assertEquals(1, page.items.size)
        assertEquals(DictionaryEntry(pathId, "AAA1 $marker"), page.items.single().careerPath)
    }

    @Test
    fun `a soft-deleted referenced entry keeps resolving and resubmitting its id is not a change`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("career-softdel-admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val client = authedClient(adminEmail, "pw-123456789")
        val created = client.createPlainUser("career-softdel")

        val marker = UUID.randomUUID().toString().take(8)
        val (pathId) = TestDictionaries.append(Dictionary.CAREER_PATH, "Gone $marker")
        client.put("/api/v1/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                UserUpdateRequest(
                    name = created.name, email = created.email, roles = emptyList(),
                    careerPathId = pathId,
                ),
            )
        }.let { assertEquals(HttpStatusCode.NoContent, it.status) }

        TestDictionaries.remove(Dictionary.CAREER_PATH, pathId)

        // The retained value still resolves…
        val read = client.get("/api/v1/users/${created.id}").body<UserResponse>()
        assertEquals(DictionaryEntry(pathId, "Gone $marker"), read.careerPath)

        // …and resubmitting the (now soft-deleted) current id passes — it is not a change.
        val resubmit = client.put("/api/v1/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                UserUpdateRequest(
                    name = "Renamed", email = created.email, roles = emptyList(),
                    careerPathId = pathId,
                ),
            )
        }
        assertEquals(HttpStatusCode.NoContent, resubmit.status)
        assertEquals(DictionaryEntry(pathId, "Gone $marker"), client.get("/api/v1/users/${created.id}").body<UserResponse>().careerPath)
    }

    @Test
    fun `assigning an unknown, wrong-dictionary, or soft-deleted entry id is 400`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("career-400-admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val client = authedClient(adminEmail, "pw-123456789")
        val created = client.createPlainUser("career-400")

        val marker = UUID.randomUUID().toString().take(8)
        val (specId) = TestDictionaries.append(Dictionary.CAREER_SPECIALIZATION, "WrongDict $marker")
        val (deadId) = TestDictionaries.append(Dictionary.CAREER_PATH, "Dead $marker")
        TestDictionaries.remove(Dictionary.CAREER_PATH, deadId)

        suspend fun putCareerPath(id: UInt): HttpStatusCode = client.put("/api/v1/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                UserUpdateRequest(
                    name = created.name, email = created.email, roles = emptyList(),
                    careerPathId = id,
                ),
            )
        }.status

        assertEquals(HttpStatusCode.BadRequest, putCareerPath(999_999_999u))
        assertEquals(HttpStatusCode.BadRequest, putCareerPath(specId))
        assertEquals(HttpStatusCode.BadRequest, putCareerPath(deadId))
        // Nothing stuck: the user still has no career path.
        assertEquals(null, client.get("/api/v1/users/${created.id}").body<UserResponse>().careerPath)
    }

    @Test
    fun `POST users with career fields returns them resolved on both response shapes`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("career-create-admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val client = authedClient(adminEmail, "pw-123456789")

        val marker = UUID.randomUUID().toString().take(8)
        val (pathId) = TestDictionaries.append(Dictionary.CAREER_PATH, "CreatePath $marker")
        val (levelId) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "CreateLevel $marker")

        val plain = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(
                UserRequest(
                    name = "Career Plain", email = uniqueEmail("career-plain"), password = "pw-123456789",
                    careerPathId = pathId, seniorityLevelId = levelId,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, plain.status)
        val plainBody = plain.body<UserResponse>()
        assertEquals(DictionaryEntry(pathId, "CreatePath $marker"), plainBody.careerPath)
        assertEquals(null, plainBody.careerSpecialization)
        assertEquals(DictionaryEntry(levelId, "CreateLevel $marker"), plainBody.seniorityLevel)

        // The sendEmail shape (log transport in tests) resolves them too.
        val mailed = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(
                UserRequest(
                    name = "Career Mailed", email = uniqueEmail("career-mailed"), password = "pw-123456789",
                    sendEmail = true, careerPathId = pathId,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, mailed.status)
        val mailedBody = mailed.body<UserCreateResponse>()
        assertEquals(true, mailedBody.emailSent)
        assertEquals(DictionaryEntry(pathId, "CreatePath $marker"), mailedBody.careerPath)

        val invalid = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(
                UserRequest(
                    name = "Career Invalid", email = uniqueEmail("career-invalid"), password = "pw-123456789",
                    careerPathId = levelId, // a SENIORITY_LEVEL id in the CAREER_PATH slot
                ),
            )
        }
        assertEquals(HttpStatusCode.BadRequest, invalid.status)
    }
}
