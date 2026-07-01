package ch.nokillswit.templates

import ch.nokillswit.infra.paging.PageResponse
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
