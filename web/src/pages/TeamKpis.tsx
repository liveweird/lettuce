import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { canAudit, hasFeature } from "../api/session";
import { getTeam } from "../api/teams";
import { teamKpiCreateLink, teamKpisLink } from "../utils/teamKpiLinks";
import { teamDetailsLink } from "../utils/teamLinks";
import TeamKpiTable from "./TeamKpiTable";
import { loadErrorMessage } from "../utils/saveError";

const DEFAULT_BACK_TO = "/?tab=myTeams";

// The per-team KPI drill-down reached from Dashboard → My teams (the team-pinned drill-down shape),
// or from the Team details page (`?from=team`, v3.24.0 — the back link returns there instead):
// the KPI table pinned to one team, with the prefilled "New team KPI" entry point for anyone who
// may set KPIs here — the server-computed canManageKpis capability (v2.34.0: the manager AND the
// chain above; the old managerId === getUserId() inference wrongly hid the button from chain
// managers). Since v3.24.0 an HR auditor who does NOT manage the team gets the org-wide `view=all`
// auditor list (still pinned to this one team via `teamId`) instead of the manage-only `managed`
// view, with an auditor-flavored hint line. A team the caller has no standing over renders an
// empty table.
export default function TeamKpis() {
  const { t } = useTranslation();
  const params = useParams<{ teamId: string }>();
  const [searchParams] = useSearchParams();
  const fromTeam = searchParams.get("from") === "team";

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
  if (!idIsValid) return <Navigate to={DEFAULT_BACK_TO} replace />;

  const backTo = teamKpisLink(teamId);
  const canManageKpis = team?.canManageKpis === true;
  const auditView = canAudit() && !canManageKpis;
  const view = auditView ? "all" : "managed";

  const teamLabel = team?.name ?? t("dashboard.teamFallback", { id: teamId });
  const backLinkTo = fromTeam ? teamDetailsLink(teamId) : DEFAULT_BACK_TO;
  const backLinkLabel = fromTeam
    ? t("feedback.backToLabel", { label: teamLabel })
    : t("feedback.backToLabel", { label: t("dashboard.tabs.myTeams") });

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={backLinkTo} size="sm">
          {backLinkLabel}
        </Anchor>
        <Title order={2}>
          {t("teamKpi.kpisOf", { team: teamLabel })}
        </Title>
        <Text size="sm" c="dimmed">
          {t(auditView ? "teamKpi.kpisOfAuditHint" : "teamKpi.kpisOfHint")}
        </Text>
      </Stack>

      {isError && (
        <Alert color="red" variant="light" title={t("teams.loadFailed")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <TeamKpiTable view={view} teamId={teamId} settingsKey="teamKpis.team" backTo={backTo} />

      {canManageKpis && (
        // The prefilled create entry point, below the list — the house footer convention
        // (the UserGoals pattern).
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to={teamKpiCreateLink(teamId, backTo)}
            leftSection={<IconPlus size={16} />}
          >
            {t("teamKpi.newKpi")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
