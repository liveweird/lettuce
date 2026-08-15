package ch.nokillswit.templates

import ch.nokillswit.infra.db.containsNormalized
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val TemplateServiceKey = AttributeKey<TemplateService>("TemplateService")

const val CONTENT_PREVIEW_LENGTH = 200

data class TemplateListFilter(
    val name: String? = null,
)

data class TemplateListResult(
    val items: List<TemplateListItem>,
    val total: Long,
)

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to TemplateService.Templates.id,
    "name" to TemplateService.Templates.name,
)

class TemplateService(val database: R2dbcDatabase) {
    object Templates : UIntIdTable("templates") {
        // Uniqueness is enforced by a partial unique index (active rows only) in migration V16,
        // so a soft-deleted template frees its name. Exposed table defs are query-only (not DDL),
        // so this column carries no `.uniqueIndex()`.
        val name = varchar("name", length = 100)
        val content = text("content")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Templates.markedAsDeleted eq false

    suspend fun create(template: Template): UInt = suspendTransaction(database) {
        validate(template)
        val newRecord = Templates.insert {
            it[name] = template.name
            it[content] = template.content
        }
        newRecord[Templates.id].value
    }

    suspend fun read(id: UInt): Template? = suspendTransaction(database) {
        Templates.selectAll()
            .where { (Templates.id eq id) and active() }
            .map { row ->
                Template(
                    name = row[Templates.name],
                    content = row[Templates.content],
                )
            }
            .singleOrNull()
    }

    suspend fun update(id: UInt, template: Template): Int = suspendTransaction(database) {
        validate(template)
        Templates.update({ (Templates.id eq id) and (Templates.markedAsDeleted eq false) }) {
            it[name] = template.name
            it[content] = template.content
        }
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        Templates.update({ (Templates.id eq id) and (Templates.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    suspend fun list(filter: TemplateListFilter, paging: PageRequest): TemplateListResult =
        suspendTransaction(database) {
            val predicate: Op<Boolean> = buildPredicate(filter) and active()
            val total = Templates.selectAll().where { predicate }.count()
            val rows = Templates.selectAll()
                .where { predicate }
                .applyPaging(paging, SORTABLE_COLUMNS)
                .map { row ->
                    TemplateListItem(
                        id = row[Templates.id].value,
                        name = row[Templates.name],
                        contentPreview = row[Templates.content].take(CONTENT_PREVIEW_LENGTH),
                    )
                }
                .toList()
            TemplateListResult(items = rows, total = total)
        }

    private fun buildPredicate(filter: TemplateListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.name?.takeIf { it.isNotBlank() }?.let {
            op = op and (Templates.name.containsNormalized(it))
        }
        return op
    }

    // Same rules the route enforces (single source in Template.kt) — re-checked here so
    // direct service callers stay guarded too.
    private fun validate(template: Template) {
        validateTemplateName(template.name)
        validateTemplateContent(template.content)
    }
}
