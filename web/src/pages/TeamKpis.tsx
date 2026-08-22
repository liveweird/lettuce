import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useParams } from "react-router-dom";
import { Alert, Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { hasFeature } from "../api/session";
import { getTeam } from "../api/teams";
import { teamKpiCreateLink, teamKpisLink } from "../utils/teamKpiLinks";
import TeamKpiTable from "./TeamKpiTable";
import { loadErrorMessage } from "../utils/saveError";

const BACK_TO = "/?tab=myTeams";

// The per-team KPI drill-down reached from Dashboard → My teams (the team-pinned drill-down shape):
// the managed KPI table pinned to one team, with the prefilled "New team KPI" entry point for
// anyone who may set KPIs here — the server-computed canManageKpis capability (v2.34.0: the
// manager AND the chain above; the old managerId === getUserId() inference wrongly hid the
// button from chain managers). A team the caller does not manage renders an empty table.
export default function TeamKpis() {
  const { t } = useTranslation();
  const params = useParams<{ teamId: string }>();

  const teamId = Number(params.teamId);
  const idIsValid = Number.isFinite(teamId) && teamId > 0;

  // Only resolves the heading + the manager gate — the table has its own query and error state.
  const { data: team, isError, error } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => getTeam(teamId),
    enabled: idIsValid,
    retry: false,
  });

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("TEAM_KPIS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={BACK_TO} replace />;

  const backTo = teamKpisLink(teamId);
  const canManageKpis = team?.canManageKpis === true;

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={BACK_TO} size="sm">
          {t("feedback.backToLabel", { label: t("dashboard.tabs.myTeams") })}
        </Anchor>
        <Title order={2}>
          {t("teamKpi.kpisOf", { team: team?.name ?? t("dashboard.teamFallback", { id: teamId }) })}
        </Title>
        <Text size="sm" c="dimmed">
          {t("teamKpi.kpisOfHint")}
        </Text>
      </Stack>

      {isError && (
        <Alert color="red" variant="light" title={t("teams.loadFailed")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <TeamKpiTable view="managed" teamId={teamId} settingsKey="teamKpis.team" backTo={backTo} />

      {canManageKpis && (
        // The prefilled create entry point, below the list — the house footer convention
        // (the UserGoals pattern).
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to={teamKpiCreateLink(teamId, team?.name, backTo)}
            leftSection={<IconPlus size={16} />}
          >
            {t("teamKpi.newKpi")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
