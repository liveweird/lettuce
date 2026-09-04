import { useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Paper, Select, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature } from "../api/session";
import { listAllTeams } from "../api/teams";
import { activateTeamKpi, createTeamKpi } from "../api/teamkpis";
import DiscardGuard from "../components/DiscardGuard";
import CreateActivateModals from "../components/CreateActivateModals";
import FormFooter from "../components/FormFooter";
import MetaStrip from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import TeamKpiDefinitionFields from "../components/TeamKpiDefinitionFields";
import { useCreateThenActivate } from "../hooks/useCreateThenActivate";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
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
  // The one cancel guard (v3.5.0): a picked team or any typed definition is work worth a confirm.
  const { requestCancel, guardProps } = useDiscardGuard({
    isDirty: () => picked != null || form.isDirty(),
    to: backTo,
    title: t("teamKpi.discardTitle"),
    message: t("teamKpi.discardMessage"),
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
    <>
      <PageHeader title={t("teamKpi.createTitle")} description={t("teamKpi.createHint")} mb="lg" />
      <Container size="md" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <form onSubmit={form.onSubmit(save)} noValidate>
            <Stack>
              {/* The context line (v3.5.0): the team — the picker keeps its name via aria-label. */}
              <MetaStrip
                items={[
                  {
                    key: "team",
                    label: t("teamKpi.team"),
                    value: showPicker ? (
                      <Select
                        aria-label={t("teamKpi.team")}
                        placeholder={t("teamKpi.pickTeam")}
                        data={options}
                        value={picked}
                        onChange={setPicked}
                        searchable
                        clearable
                        nothingFoundMessage={t("teamKpi.noManagedTeams")}
                        w={260}
                      />
                    ) : (
                      // The `#id` placeholder shows only until the pool resolves the canonical name.
                      <Text size="sm" fw={500}>
                        {preselectedTeam?.name ?? `#${preselectedId}`}
                      </Text>
                    ),
                  },
                  {
                    key: "manager",
                    label: t("teamKpi.manager"),
                    value: <Text size="sm">{t("common.state.you")}</Text>,
                  },
                ]}
              />

              <TeamKpiDefinitionFields form={form} />

              {flow.error && (
                <Alert color="red" variant="light">
                  {flow.error}
                </Alert>
              )}

              <FormFooter>
                <Button type="button" variant="default" onClick={requestCancel} disabled={flow.submitting}>
                  {t("common.action.cancel")}
                </Button>
                <Button type="submit" loading={flow.submitting} disabled={!teamId || flow.createdId != null}>
                  {t("common.action.create")}
                </Button>
              </FormFooter>
            </Stack>
          </form>
        </Paper>
      </Container>

      <DiscardGuard {...guardProps} />
      <CreateActivateModals
        area="teamKpi"
        createdId={flow.createdId}
        promptClosed={flow.promptClosed}
        activating={flow.activating}
        onFinishAsDraft={flow.finishAsDraft}
        onActivate={flow.activateNow}
      />
    </>
  );
}
