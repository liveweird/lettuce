import { Alert, SimpleGrid, Skeleton, Stack } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { IconUsersGroup } from "@tabler/icons-react";
import { canAudit } from "../api/session";
import { listAllTeamMembers } from "../api/teams";
import AccountStatusSelect from "../components/AccountStatusSelect";
import EmptyState from "../components/EmptyState";
import { useHiddenInactive } from "../hooks/useHiddenInactive";
import FilterPanel from "../components/FilterPanel";
import PersonCard from "../components/PersonCard";
import PersonCardBody from "../components/PersonCardStats";
import {
  deactivatedParam,
  isStatusFilterActive,
  useAccountStatusFilter,
} from "../hooks/useAccountStatusFilter";
import { groupTeamRows } from "../utils/teamRows";
import { loadErrorMessage } from "../utils/saveError";

const SETTINGS_KEY = "managers";

// The dashboard "My managers" view: a person-card grid (not a table) — typically 1–3 people,
// so narrow cards use the width far better than full-width spreadsheet rows.
export default function ManagersTable() {
  const { t } = useTranslation();
  // The Any / Active / Inactive filter (default Active), persisted per page.
  const [statusFilter, setStatusFilter] = useAccountStatusFilter(SETTINGS_KEY);
  const { data, isLoading, isError, error } = useQuery({
    // The leading ["managers"] stays the invalidation prefix (see userQueries.ts).
    queryKey: ["managers", statusFilter],
    // The paging loop, not a single capped page — correct even past 100 memberships
    // (the checkup-#10 note; below that the behavior is identical).
    queryFn: () => listAllTeamMembers("managers", undefined, deactivatedParam(statusFilter)),
  });

  // Container-query columns (v3.4.0): up to three cards across, keyed on the grid's own width
  // — kept in step with TeamMembersTable's GRID_COLS so the dashboard grids stay coherent.
  const gridCols = { base: 1, "44em": 2, "84em": 3 };

  const managers = groupTeamRows(data ?? []);
  // The hint below shows only when the default filter really hides someone.
  const inactiveHidden = useHiddenInactive(
    { view: "managers" },
    data !== undefined && managers.length === 0 && !isStatusFilterActive(statusFilter),
  );

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={isStatusFilterActive(statusFilter) ? 1 : 0} storageKey={SETTINGS_KEY}>
        <AccountStatusSelect value={statusFilter} onChange={setStatusFilter} />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("users.loadManagersFailed")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      {isLoading && !data ? (
        <SimpleGrid type="container" cols={gridCols} spacing="md">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={150} radius="md" />
          ))}
        </SimpleGrid>
      ) : managers.length > 0 ? (
        <SimpleGrid component="ul" m={0} p={0} style={{ listStyle: "none" }} type="container" cols={gridCols} spacing="md">
          {managers.map((m) => (
            <PersonCard
              key={m.userId}
              name={m.name}
              email={m.email}
              teams={m.teams}
              inactive={m.deactivated}
              body={
                <PersonCardBody
                  person={m}
                  stats="manager"
                  actionsVariant="icons"
                  actions={{
                    userId: m.userId,
                    name: m.name,
                    labels: "users",
                    deactivated: m.deactivated,
                    back: "/?tab=managers",
                    // No drillFrom on purpose: the feedbacks drill-down historically omits
                    // `from` here (its resolver defaults to managers); 1:1s/goals default in.
                    // The career timeline is self/chain/HR-only since v2.25.0 — a manager's
                    // history is not their report's to browse, so only auditors keep the link.
                    show: {
                      career: canAudit(),
                      activity: canAudit(),
                      provide: true,
                      ask: true,
                      feedbacks: true,
                      oneOnOnes: true,
                      goals: true,
                    },
                  }}
                />
              }
            />
          ))}
        </SimpleGrid>
      ) : (
        !isError && (
          <EmptyState
            icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
            label={t("users.noManagers")}
            description={inactiveHidden ? t("users.inactiveHiddenHint") : undefined}
          />
        )
      )}
    </Stack>
  );
}
