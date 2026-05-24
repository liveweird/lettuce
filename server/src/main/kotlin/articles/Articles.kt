package ch.nokillswit.articles

import io.ktor.resources.*
import io.ktor.server.application.*
import io.ktor.server.resources.get
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/articles")
class Articles(val sort: String? = "new")

fun Application.configureArticles() {
    routing {
        get<Articles> { article ->
            call.respond("List of articles sorted starting from ${article.sort}")
        }
    }
}
