package ch.nokillswit.integration

import ch.nokillswit.users.toResponses
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.future.future
import org.dataloader.DataLoader
import org.dataloader.DataLoaderFactory
import org.dataloader.DataLoaderRegistry
import org.dataloader.MappedBatchLoader

/**
 * One fresh registry per request (graphql-java dispatches loaders itself): every nested list
 * field batches through a single service call per distinct (loader, arg-set), so a full page
 * of parents costs a handful of SQL statements instead of one per row. Keys are the Long ids
 * the parent Map trees carry (see GraphQLJson.kt); year-scoped loaders key on (id, year).
 */
internal fun newDataLoaderRegistry(services: IntegrationServices, scope: CoroutineScope): DataLoaderRegistry {
    val registry = DataLoaderRegistry()
    registry.registerUserLoaders(services, scope)
    registry.registerDaysOffLoaders(services, scope)
    registry.registerTeamLoaders(services, scope)
    return registry
}

private fun DataLoaderRegistry.registerUserLoaders(services: IntegrationServices, scope: CoroutineScope) {
    register(
        "careerHistoryByUser",
        mappedLoader(scope) { keys: Set<Long> ->
            val rowsByUser = services.careerPositions.listRowsByUserIds(keys.toUIntSet())
            val refs = rowsByUser.values.flatten()
                .flatMap { listOf(it.careerPathId, it.careerSpecializationId, it.seniorityLevelId) }
            val entries = services.users.resolveEntryRefs(*refs.toTypedArray())
            keys.associateWith { key ->
                toResponses(rowsByUser[key.toUInt()].orEmpty(), entries).map { it.toGraphQL() }
            }
        },
    )
    register(
        "teamsByUser",
        mappedLoader(scope) { keys: Set<Long> ->
            val byUser = services.users.teamsByUserIds(keys.toUIntSet())
            keys.associateWith { key -> byUser[key.toUInt()].orEmpty().map { it.toGraphQL() } }
        },
    )
    register(
        "reviewsBySubordinate",
        mappedLoader(scope) { keys: Set<Long> ->
            val byUser = services.reviews.listBySubordinateIds(keys.toUIntSet())
            keys.associateWith { key -> byUser[key.toUInt()].orEmpty().map { it.toGraphQL() } }
        },
    )
    // ONE loader behind both person-history fields (User.teamMemberships and
    // User.managedTeamPeriods): historyByUserIds reads both lists in one transaction, so a query
    // selecting both fields pays for it once; each fetcher projects its own list.
    register(
        "teamHistoryByUser",
        mappedLoader(scope) { keys: Set<Long> ->
            val byUser = services.teamHistory.historyByUserIds(keys.toUIntSet())
            keys.associateWith { key ->
                val history = byUser[key.toUInt()]
                mapOf(
                    "memberships" to history?.memberships.orEmpty().map { it.toGraphQL() },
                    "managerPeriods" to history?.managerPeriods.orEmpty().map { it.toGraphQL() },
                )
            }
        },
    )
}

private fun DataLoaderRegistry.registerDaysOffLoaders(services: IntegrationServices, scope: CoroutineScope) {
    register(
        "daysOffByUser",
        mappedLoader(scope) { keys: Set<Pair<Long, Int?>> ->
            val byYear = keys.groupBy({ it.second }, { it.first }).mapValues { (year, ids) ->
                services.daysOff.listByUserIds(ids.toUIntSet(), year)
            }
            keys.associateWith { (userId, year) ->
                byYear.getValue(year)[userId.toUInt()].orEmpty().map { it.toGraphQL() }
            }
        },
    )
    // The ONE loader whose SDL field is non-null (User.daysOffBudget!): safe because budgets()
    // pins "a (default-pool) row for every existing user id" (see its KDoc) and every User
    // parent is an existing row — the mapNotNull below can therefore never leave a key
    // unmapped (checkup #30, B-M3; the invariant is documented on both sides on purpose).
    // Since v3.2.0 the field is the DEFAULT pool's row (defaultBudgets — one row per user;
    // the multi-pool budgets() would make associateBy keep the LAST pool row).
    register(
        "budgetByUserYear",
        mappedLoader(scope) { keys: Set<Pair<Long, Int>> ->
            val byYear = keys.groupBy({ it.second }, { it.first }).mapValues { (year, ids) ->
                services.daysOff.defaultBudgets(ids.toUIntSet(), year).associateBy { it.userId }
            }
            keys.mapNotNull { key ->
                byYear.getValue(key.second)[key.first.toUInt()]?.let { key to it.toGraphQL() }
            }.toMap()
        },
    )
    // Every pool of the user (v3.2.0) — a list field, the daysOffByUser shape.
    register(
        "budgetsByUserYear",
        mappedLoader(scope) { keys: Set<Pair<Long, Int>> ->
            val byYear = keys.groupBy({ it.second }, { it.first }).mapValues { (year, ids) ->
                services.daysOff.budgets(ids.toUIntSet(), year).groupBy { it.userId }
            }
            keys.associateWith { (userId, year) ->
                byYear.getValue(year)[userId.toUInt()].orEmpty().map { it.toGraphQL() }
            }
        },
    )
    register(
        "correctionsByUser",
        mappedLoader(scope) { keys: Set<Pair<Long, Int?>> ->
            val byYear = keys.groupBy({ it.second }, { it.first }).mapValues { (year, ids) ->
                services.daysOff.listCorrectionsByUserIds(ids.toUIntSet(), year)
            }
            keys.associateWith { (userId, year) ->
                byYear.getValue(year)[userId.toUInt()].orEmpty().map { it.toGraphQL() }
            }
        },
    )
}

private fun DataLoaderRegistry.registerTeamLoaders(services: IntegrationServices, scope: CoroutineScope) {
    register(
        "kpisByTeam",
        mappedLoader(scope) { keys: Set<Long> ->
            val byTeam = services.teamKpis.listByTeamIds(keys.toUIntSet())
            keys.associateWith { key -> byTeam[key.toUInt()].orEmpty().map { it.toGraphQL() } }
        },
    )
    register(
        "valuesByKpi",
        mappedLoader(scope) { keys: Set<Long> ->
            val byKpi = services.teamKpis.valuesByKpiIds(keys.toUIntSet())
            keys.associateWith { key -> byKpi[key.toUInt()].orEmpty().map { it.toGraphQL() } }
        },
    )
    register(
        "membersByTeam",
        mappedLoader(scope) { keys: Set<Long> ->
            val byTeam = services.teams.membersWithNamesByTeamIds(keys.toUIntSet())
            keys.associateWith { key ->
                byTeam[key.toUInt()].orEmpty().map { (id, name) ->
                    mapOf<String, Any?>("id" to id.toLong(), "name" to name)
                }
            }
        },
    )
    register(
        "membershipsByTeam",
        mappedLoader(scope) { keys: Set<Long> ->
            val byTeam = services.teamHistory.membershipsByTeamIds(keys.toUIntSet())
            keys.associateWith { key ->
                byTeam[key.toUInt()].orEmpty().map { period ->
                    period.toGraphQL() + ("user" to userRef(period.userId, period.userName))
                }
            }
        },
    )
    register(
        "managerPeriodsByTeam",
        mappedLoader(scope) { keys: Set<Long> ->
            val byTeam = services.teamHistory.managerPeriodsByTeamIds(keys.toUIntSet())
            keys.associateWith { key ->
                byTeam[key.toUInt()].orEmpty().map { period ->
                    period.toGraphQL() + ("manager" to userRef(period.managerId, period.managerName))
                }
            }
        },
    )
}

/** The UserRef map (UInt ids must become Long — see GraphQLJson.kt). */
private fun userRef(id: UInt, name: String): Map<String, Any?> = mapOf("id" to id.toLong(), "name" to name)

private fun Collection<Long>.toUIntSet(): Set<UInt> = map { it.toUInt() }.toSet()

private fun <K : Any, V> mappedLoader(
    scope: CoroutineScope,
    block: suspend (Set<K>) -> Map<K, V>,
): DataLoader<K, V> =
    DataLoaderFactory.newMappedDataLoader(MappedBatchLoader<K, V> { keys -> scope.future { block(keys) } })
