package ch.nokillswit.templates

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.plugins.respondProblem
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.BadRequestException
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

// Column limit (templates.name varchar(100)) enforced up-front: 400 instead of a DB-level 500.
private const val MAX_TEMPLATE_NAME_LENGTH = 100

private fun validateTemplateName(name: String) {
    if (name.isBlank()) throw BadRequestException("Template name must not be blank")
    if (name.length > MAX_TEMPLATE_NAME_LENGTH) {
        throw BadRequestException("Template name must be at most $MAX_TEMPLATE_NAME_LENGTH characters")
    }
}

fun Application.configureTemplateRoutes() {
    val templateService = attributes[TemplateServiceKey]

    routing {
        authenticate {
            get<Templates> {
                call.caller()
                val paging = call.parsePaging(sortable = setOf("id", "name"))
                val filter = TemplateListFilter(
                    name = call.request.queryParameters.optionalString("name"),
                )
                val result = templateService.list(filter, paging)
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<Templates> {
                val caller = call.caller()
                requireAdmin(caller)
                val template = call.receive<Template>()
                validateTemplateName(template.name)
                val id = templateService.create(template)
                audit("template.created", "byUserId" to caller.userId.toLong(), "templateId" to id.toLong())
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
                val caller = call.caller()
                requireAdmin(caller)
                val existing = templateService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Template not found")
                    return@put
                }
                val template = call.receive<Template>()
                validateTemplateName(template.name)
                templateService.update(route.id, template)
                audit("template.updated", "byUserId" to caller.userId.toLong(), "templateId" to route.id.toLong())
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Templates.Id> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                if (templateService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Template not found")
                } else {
                    audit("template.deleted", "byUserId" to caller.userId.toLong(), "templateId" to route.id.toLong())
                    call.respond(HttpStatusCode.NoContent)
                }
            }
        }
    }
}
