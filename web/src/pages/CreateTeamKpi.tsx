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
import { safeBackParam } from "../utils/url";

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
  const backTo = safeBackParam(searchParams) ?? BACK_TO;

  const [picked, setPicked] = useState<string | null>(null);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);
  const flow = useCreateThenActivate({
    area: "teamKpi",
    backTo,
    activate: activateTeamKpi,
    invalidate: invalidateTeamKpi,
  });

  const form = useForm<TeamKpiDefinitionFormValues>({
    initialValues: { title: "", description: "", type: "NUMBER", targetValue: "", targetDirection: "AT_LEAST" },
    validate: teamKpiDefinitionValidation(t),
  });

  // The manageable pool ALWAYS loads (v2.35.0) — subtree-wide since v2.26.0 (includeIndirect
  // widens the managerId filter server-side), paged to completion (the listAllTeams loop). A
  // prefilled team (the drill-down flow) resolves its display name against this pool — never
  // a URL param — and an id outside the caller's manageable set falls back to the picker
  // once the pool settles.
  const { data: managedTeams, isSuccess: teamsReady } = useQuery({
    queryKey: ["teams", "kpiPicker", userId],
    queryFn: () => listAllTeams({ managerId: userId!, includeIndirect: true }),
    staleTime: 5 * 60 * 1000,
    enabled: userId != null,
  });
  const options = useMemo(
    () => (managedTeams ?? []).map((row) => ({ value: String(row.id), label: row.name })),
    [managedTeams],
  );
  const preselectedTeam = preselected
    ? (managedTeams ?? []).find((row) => row.id === preselectedId)
    : undefined;
  const showPicker = !preselected || (teamsReady && !preselectedTeam);
  const teamId = preselectedTeam?.id ?? (showPicker && picked != null ? Number(picked) : null);

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("TEAM_KPIS")) return <Navigate to="/" replace />;

  async function save(values: TeamKpiDefinitionFormValues) {
    if (!teamId) return;
    await flow.submitCreate(() =>
      createTeamKpi({
        teamId,
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
              {showPicker ? (
                <Select
                  label={t("teamKpi.team")}
                  placeholder={t("teamKpi.pickTeam")}
                  data={options}
                  value={picked}
                  onChange={setPicked}
                  searchable
                  clearable
                  nothingFoundMessage={t("teamKpi.noManagedTeams")}
                />
              ) : (
                // The `#id` placeholder shows only until the pool resolves the canonical name.
                <ReadOnlyField label={t("teamKpi.team")}>
                  <Text size="sm" fw={500}>
                    {preselectedTeam?.name ?? `#${preselectedId}`}
                  </Text>
                </ReadOnlyField>
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
              <Button type="submit" loading={flow.submitting} disabled={!teamId || flow.createdId != null}>
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
