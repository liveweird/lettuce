package ch.nokillswit.templates

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

@Serializable
data class TemplatePageResponse(
    val items: List<TemplateListItem>,
    val page: Int,
    val pageSize: Int,
    val total: Long,
)
