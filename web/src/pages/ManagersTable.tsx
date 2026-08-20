import { Alert, SimpleGrid, Skeleton } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { IconUsersGroup } from "@tabler/icons-react";
import { canAudit } from "../api/session";
import { listAllTeamMembers } from "../api/teams";
import EmptyState from "../components/EmptyState";
import PersonCard from "../components/PersonCard";
import PersonCardBody from "../components/PersonCardStats";
import { groupTeamRows } from "../utils/teamRows";
import { loadErrorMessage } from "../utils/saveError";

// The dashboard "My managers" view: a person-card grid (not a table) — typically 1–3 people,
// so narrow cards use the width far better than full-width spreadsheet rows.
export default function ManagersTable() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["managers"],
    // The paging loop, not a single capped page — correct even past 100 memberships
    // (the checkup-#10 note; below that the behavior is identical).
    queryFn: () => listAllTeamMembers("managers"),
  });

  // Capped at 2 per row (v1.34.0) — kept in step with TeamMembersTable's GRID_COLS so the
  // dashboard grids stay coherent.
  const gridCols = { base: 1, sm: 2 };

  if (isLoading && !data) {
    return (
      <SimpleGrid cols={gridCols} spacing="md">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={150} radius="md" />
        ))}
      </SimpleGrid>
    );
  }

  const managers = groupTeamRows(data ?? []);

  return (
    <>
      {isError && (
        <Alert color="red" variant="light" title={t("users.loadManagersFailed")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      {managers.length > 0 ? (
        <SimpleGrid component="ul" m={0} p={0} style={{ listStyle: "none" }} cols={gridCols} spacing="md">
          {managers.map((m) => (
            <PersonCard
              key={m.userId}
              name={m.name}
              email={m.email}
              teams={m.teams}
              body={
                <PersonCardBody
                  person={m}
                  stats="manager"
                  actions={{
                    userId: m.userId,
                    name: m.name,
                    labels: "users",
                    back: "/?tab=managers",
                    // No drillFrom on purpose: the feedbacks drill-down historically omits
                    // `from` here (its resolver defaults to managers); 1:1s/goals default in.
                    // The career timeline is self/chain/HR-only since v2.25.0 — a manager's
                    // history is not their report's to browse, so only auditors keep the link.
                    show: {
                      career: canAudit(),
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
          />
        )
      )}
    </>
  );
}
