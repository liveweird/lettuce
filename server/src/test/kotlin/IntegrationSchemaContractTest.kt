package ch.nokillswit

import ch.nokillswit.integration.parseIntegrationSchema
import graphql.schema.GraphQLEnumType
import graphql.schema.GraphQLFieldsContainer
import graphql.schema.GraphQLNamedType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The GraphQL contract gate (Docker-free, the OpenApiSpecTest sibling): the committed SDL at
 * `graphql/schema.graphqls` IS the runtime schema (SDL-first — configureIntegration parses this
 * exact file at boot), so this test pins the contract's static invariants — it parses into an
 * executable schema, it stays read-only (no Mutation/Subscription — the read-only-by-construction
 * guarantee), its root surface changes only deliberately, and every type/field/argument carries
 * a description (GQL-CON-004 — the "documented contract" bar the REST spec holds itself to),
 * and no caller-relative capability flag or secret ever appears as a field (GQL-SEC-003).
 */
class IntegrationSchemaContractTest {

    private val sdl = checkNotNull(javaClass.getResource("/graphql/schema.graphqls")) {
        "graphql/schema.graphqls missing from the classpath"
    }.readText()

    @Test
    fun `the committed SDL builds and declares no mutation or subscription`() {
        val schema = parseIntegrationSchema(sdl)
        assertNull(schema.mutationType, "the integration API is read-only by construction")
        assertNull(schema.subscriptionType, "the integration API is read-only by construction")
    }

    @Test
    fun `the query surface is exactly the declared v1 roots`() {
        val schema = parseIntegrationSchema(sdl)
        val roots = schema.queryType.fieldDefinitions.map { it.name }.sorted()
        // Additive evolution is the rule (GQL-CON-003): extending this list is fine — do it
        // consciously, together with the SDL, the resolvers, and the feature doc.
        assertEquals(
            listOf(
                "daysOff", "daysOffPoolTypes", "performanceReviews", "reviewPeriods",
                "team", "teamKpis", "teams", "user", "users",
            ),
            roots,
        )
    }

    @Test
    fun `every type, field, argument, and enum value is documented`() {
        val schema = parseIntegrationSchema(sdl)
        val undocumented = mutableListOf<String>()
        schema.typeMap.values
            .filterIsInstance<GraphQLNamedType>()
            .filterNot { it.name.startsWith("__") }
            .filterNot { it.name in BUILT_IN_SCALARS }
            .forEach { type ->
                if (type.description.isNullOrBlank()) undocumented += type.name
                if (type is GraphQLFieldsContainer) {
                    type.fieldDefinitions.forEach { field ->
                        if (field.description.isNullOrBlank()) undocumented += "${type.name}.${field.name}"
                        field.arguments.forEach { arg ->
                            if (arg.description.isNullOrBlank()) {
                                undocumented += "${type.name}.${field.name}(${arg.name})"
                            }
                        }
                    }
                }
                // Enum VALUES too — checkup #30 (B-M5/C-M3): the walk previously skipped them,
                // so the test's name overclaimed.
                if (type is GraphQLEnumType) {
                    type.values.forEach { value ->
                        if (value.description.isNullOrBlank()) undocumented += "${type.name}.${value.name}"
                    }
                }
            }
        assertTrue(undocumented.isEmpty(), "undocumented schema members: $undocumented")
    }

    @Test
    fun `no capability flag or secret is declared as a field`() {
        // GQL-SEC-003's mechanical pin (checkup #30, B-M4): the DTO-to-map bridge would happily
        // surface these the moment someone declared them, and no runtime test would notice.
        val schema = parseIntegrationSchema(sdl)
        val forbidden = setOf(
            "canManage", "canRecordValues", "canCancel", "canResolve", "canCorrect", "canEdit",
            "canManageKpis", "passwordHash", "keyHash", "apiKey",
        )
        val leaked = schema.typeMap.values
            .filterIsInstance<GraphQLFieldsContainer>()
            .filterNot { it.name.startsWith("__") }
            .flatMap { type -> type.fieldDefinitions.map { type.name to it.name } }
            .filter { (_, field) -> field in forbidden }
        assertTrue(leaked.isEmpty(), "capability/secret fields leaked into the schema: $leaked")
    }

    private companion object {
        val BUILT_IN_SCALARS = setOf("Int", "Float", "String", "Boolean", "ID")
    }
}
