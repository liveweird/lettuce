package ch.nokillswit.templates

import ch.nokillswit.infra.paging.PageResponse
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable

@Serializable
data class Template(
    val name: String,
    val content: String = "",
)

@Serializable
data class TemplateResponse(
    val id: UInt,
    val name: String,
    val content: String,
)

fun Template.toResponse(id: UInt) = TemplateResponse(id, name, content)

@Serializable
data class TemplateListItem(
    val id: UInt,
    val name: String,
    val contentPreview: String,
)

typealias TemplatePageResponse = PageResponse<TemplateListItem>

// Column limit (templates.name varchar(100)) enforced up-front: 400 instead of a DB-level 500.
// Single source (the validateAlert idiom): the route checks it for the 403-before-400 ordering,
// and the service re-checks so direct service callers stay guarded too.
internal const val MAX_TEMPLATE_NAME_LENGTH = 100

internal fun validateTemplateName(name: String) {
    if (name.isBlank()) throw BadRequestException("Template name must not be blank")
    if (name.length > MAX_TEMPLATE_NAME_LENGTH) {
        throw BadRequestException("Template name must be at most $MAX_TEMPLATE_NAME_LENGTH characters")
    }
}

// The content column is unbounded `text` — this up-front check is the only limit (400, not a
// request-size blowup). Mirrored by the SPA's maxLength cap and the spec's maxLength.
internal const val MAX_TEMPLATE_CONTENT_LENGTH = 5000

internal fun validateTemplateContent(content: String) {
    if (content.length > MAX_TEMPLATE_CONTENT_LENGTH) {
        throw BadRequestException("Template content must be at most $MAX_TEMPLATE_CONTENT_LENGTH characters")
    }
}
