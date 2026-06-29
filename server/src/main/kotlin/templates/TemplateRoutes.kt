package ch.nokillswit.templates

import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.plugins.respondProblem
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.request.receive
import io.ktor.server.resources.delete
import io.ktor.server.resources.get
import io.ktor.server.resources.href
import io.ktor.server.resources.post
import io.ktor.server.resources.put
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/api/v1/templates")
class Templates {
    @Serializable
    @Resource("{id}")
    class Id(val parent: Templates = Templates(), val id: UInt)
}

fun Application.configureTemplateRoutes() {
    val templateService = attributes[TemplateServiceKey]

    routing {
        authenticate {
            get<Templates> {
                call.caller()
                val paging = call.parsePaging(sortable = setOf("id", "name"))
                val filter = TemplateListFilter(
                    name = call.request.queryParameters["name"]?.takeIf { it.isNotBlank() },
                )
                val result = templateService.list(filter, paging)
                call.respond(
                    HttpStatusCode.OK,
                    TemplatePageResponse(
                        items = result.items,
                        page = paging.page,
                        pageSize = paging.pageSize,
                        total = result.total,
                    ),
                )
            }
            post<Templates> {
                requireAdmin(call.caller())
                val template = call.receive<Template>()
                val id = templateService.create(template)
                call.response.header(HttpHeaders.Location, call.application.href(Templates.Id(id = id)))
                call.respond(HttpStatusCode.Created, template.toResponse(id))
            }
            get<Templates.Id> { route ->
                call.caller()
                val template = templateService.read(route.id)
                if (template == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Template not found")
                    return@get
                }
                call.respond(HttpStatusCode.OK, template.toResponse(route.id))
            }
            put<Templates.Id> { route ->
                requireAdmin(call.caller())
                val existing = templateService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Template not found")
                    return@put
                }
                val template = call.receive<Template>()
                templateService.update(route.id, template)
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Templates.Id> { route ->
                requireAdmin(call.caller())
                if (templateService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Template not found")
                } else {
                    call.respond(HttpStatusCode.NoContent)
                }
            }
        }
    }
}
