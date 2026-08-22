import { useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Group, Paper, Select, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature } from "../api/session";
import { listAllTeams } from "../api/teams";
import { activateTeamKpi, createTeamKpi } from "../api/teamkpis";
import CreateActivateModals from "../components/CreateActivateModals";
import ReadOnlyField from "../components/ReadOnlyField";
import TeamKpiDefinitionFields from "../components/TeamKpiDefinitionFields";
import { useCreateThenActivate } from "../hooks/useCreateThenActivate";
import {
  teamKpiDefinitionValidation,
  toKpiDefinitionBody,
  type TeamKpiDefinitionFormValues,
} from "../utils/teamKpiForm";
import { invalidateTeamKpi } from "../utils/teamKpiQueries";

// Default cancel target when no `back` param is present: the managed tab, the main entry point.
const BACK_TO = "/team-kpis?tab=managed";

/**
 * The manager's KPI-create screen: pick (or arrive with) any team in their management subtree
 * — directly managed or managed by anyone below them (v2.26.0) — define the KPI (the same
 * definition fields the DRAFT editor offers) and Create. The lifecycle (DRAFT lands, activate
 * prompt, error handling) is the shared `useCreateThenActivate` flow.
 */
export default function CreateTeamKpi() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const userId = getUserId();

  const preselectedId = Number(searchParams.get("teamId"));
  const preselected = Number.isFinite(preselectedId) && preselectedId > 0;
  const teamName = searchParams.get("teamName");
  const backParam = searchParams.get("back");
  const backTo = backParam ?? BACK_TO;

  const [team, setTeam] = useState<string | null>(preselected ? String(preselectedId) : null);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);
  const flow = useCreateThenActivate({
    area: "teamKpi",
    backTo,
    activate: activateTeamKpi,
    invalidate: invalidateTeamKpi,
  });

  const form = useForm<TeamKpiDefinitionFormValues>({
    initialValues: { title: "", description: "", type: "NUMBER", targetValue: "" },
    validate: teamKpiDefinitionValidation(t),
  });

  // The picker is skipped entirely when the team arrives prefilled (the drill-down flow).
  // Subtree-wide since v2.26.0 (includeIndirect widens the managerId filter server-side),
  // paged to completion — the listAllTeams loop, not one capped page.
  const { data: managedTeams } = useQuery({
    queryKey: ["teams", "kpiPicker", userId],
    queryFn: () => listAllTeams({ managerId: userId!, includeIndirect: true }),
    staleTime: 5 * 60 * 1000,
    enabled: !preselected && userId != null,
  });
  const options = useMemo(
    () => (managedTeams ?? []).map((row) => ({ value: String(row.id), label: row.name })),
    [managedTeams],
  );

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("TEAM_KPIS")) return <Navigate to="/" replace />;

  async function save(values: TeamKpiDefinitionFormValues) {
    if (!team) return;
    await flow.submitCreate(() =>
      createTeamKpi({
        teamId: Number(team),
        ...toKpiDefinitionBody(values),
      }),
    );
  }

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(save)} noValidate>
          <Stack>
            <Stack gap={4}>
              <Title order={2}>{t("teamKpi.createTitle")}</Title>
              <Text c="dimmed" size="sm">
                {t("teamKpi.createHint")}
              </Text>
            </Stack>

            <Group gap="xl" align="flex-start">
              {preselected ? (
                <ReadOnlyField label={t("teamKpi.team")}>
                  <Text size="sm" fw={500}>
                    {teamName ?? `#${preselectedId}`}
                  </Text>
                </ReadOnlyField>
              ) : (
                <Select
                  label={t("teamKpi.team")}
                  placeholder={t("teamKpi.pickTeam")}
                  data={options}
                  value={team}
                  onChange={setTeam}
                  searchable
                  clearable
                  nothingFoundMessage={t("teamKpi.noManagedTeams")}
                />
              )}
            </Group>

            <TeamKpiDefinitionFields form={form} />

            {flow.error && (
              <Alert color="red" variant="light">
                {flow.error}
              </Alert>
            )}

            <Group justify="flex-end" gap="sm">
              <Button type="button" variant="default" onClick={openCancel} disabled={flow.submitting}>
                {t("common.action.cancel")}
              </Button>
              <Button type="submit" loading={flow.submitting} disabled={!team || flow.createdId != null}>
                {t("common.action.create")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <CreateActivateModals
        area="teamKpi"
        backTo={backTo}
        cancelOpen={cancelOpen}
        onCancelClose={closeCancel}
        createdId={flow.createdId}
        promptClosed={flow.promptClosed}
        activating={flow.activating}
        onFinishAsDraft={flow.finishAsDraft}
        onActivate={flow.activateNow}
      />
    </Container>
  );
}
