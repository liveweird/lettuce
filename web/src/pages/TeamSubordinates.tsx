import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useParams } from "react-router-dom";
import { Alert, Anchor, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { getTeam } from "../api/client";
import TeamMembersTable from "./TeamMembersTable";

const BACK_TO = "/?tab=myTeams";

// The team-scoped subordinates view reached from Dashboard → My teams: the same person-card
// grid as the "My subordinates" tab (stats and actions included), pinned to one managed team.
// Deliberately NOT the /teams/:id/members roster. A team the caller does not manage renders an
// empty grid (the server scopes the members query to the caller's own managed teams).
export default function TeamSubordinates() {
  const { t } = useTranslation();
  const params = useParams<{ teamId: string }>();

  const teamId = Number(params.teamId);
  const idIsValid = Number.isFinite(teamId) && teamId > 0;

  // Only resolves the heading — the grid has its own query and error state.
  const { data: team, isError } = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => getTeam(teamId),
    enabled: idIsValid,
    retry: false,
  });

  if (!idIsValid) return <Navigate to={BACK_TO} replace />;

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={BACK_TO} size="sm">
          {t("feedback.backToLabel", { label: t("dashboard.tabs.myTeams") })}
        </Anchor>
        <Title order={2}>{team?.name ?? t("dashboard.teamFallback", { id: teamId })}</Title>
        <Text size="sm" c="dimmed">
          {t("dashboard.teamSubordinatesHint")}
        </Text>
      </Stack>

      {isError && (
        <Alert color="red" variant="light" title={t("teams.loadFailed")}>
          {t("teams.unknownError")}
        </Alert>
      )}

      <TeamMembersTable
        view="managed"
        teamId={teamId}
        settingsKey="teamSubordinates"
        backTo={`/teams/${teamId}/subordinates`}
        emptyMessage={t("dashboard.empty.teamMembers")}
      />
    </Stack>
  );
}
