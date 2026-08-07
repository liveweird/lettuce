import { useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Group, Paper, Select, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { activateTeamKpi, createTeamKpi, getUserId, hasFeature, listTeams } from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import ReadOnlyField from "../components/ReadOnlyField";
import TeamKpiDefinitionFields from "../components/TeamKpiDefinitionFields";
import {
  teamKpiDefinitionValidation,
  toKpiDefinitionBody,
  type TeamKpiDefinitionFormValues,
} from "../utils/teamKpiForm";
import { invalidateTeamKpi } from "../utils/teamKpiQueries";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";

// Default cancel target when no `back` param is present: the managed tab, the main entry point.
const BACK_TO = "/team-kpis?tab=managed";
const PICKER_PAGE_SIZE = 100;

/**
 * The manager's KPI-create screen: pick (or arrive with) one of the teams they manage, define
 * the KPI — the same definition fields the DRAFT editor offers — and Create. The KPI always
 * lands as DRAFT; on success a prompt asks whether to activate it immediately (Yes runs the
 * DRAFT→ACTIVE transition), and either answer returns to the originating screen (`backTo`).
 */
export default function CreateTeamKpi() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const userId = getUserId();

  const preselectedId = Number(searchParams.get("teamId"));
  const preselected = Number.isFinite(preselectedId) && preselectedId > 0;
  const teamName = searchParams.get("teamName");
  const backParam = searchParams.get("back");
  const backTo = backParam ?? BACK_TO;

  const [team, setTeam] = useState<string | null>(preselected ? String(preselectedId) : null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once the KPI exists — opens the activate prompt and retires the Create button.
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [activating, setActivating] = useState(false);
  // Closes the prompt without navigating — only the activate-failure path uses it.
  const [promptClosed, setPromptClosed] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<TeamKpiDefinitionFormValues>({
    initialValues: { title: "", description: "", type: "NUMBER", targetValue: "" },
    validate: teamKpiDefinitionValidation(t),
  });

  // The picker is skipped entirely when the team arrives prefilled (the drill-down flow).
  const { data: managedTeams } = useQuery({
    queryKey: ["teams", "kpiPicker", userId],
    queryFn: () =>
      listTeams({ page: 1, pageSize: PICKER_PAGE_SIZE, sort: "name", managerId: userId! }),
    staleTime: 5 * 60 * 1000,
    enabled: !preselected && userId != null,
  });
  const options = useMemo(
    () => (managedTeams?.items ?? []).map((row) => ({ value: String(row.id), label: row.name })),
    [managedTeams],
  );

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("TEAM_KPIS")) return <Navigate to="/" replace />;

  async function save(values: TeamKpiDefinitionFormValues) {
    if (!team) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await createTeamKpi({
        teamId: Number(team),
        ...toKpiDefinitionBody(values),
      });
      await invalidateTeamKpi(queryClient);
      showSuccessToast(t("teamKpi.toast.created"));
      // The KPI exists as a DRAFT — ask whether to activate it right away; either answer
      // then returns to the originating screen.
      setSubmitting(false);
      setCreatedId(created.id);
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "teamKpi.error.createForbidden",
          invalid: "teamKpi.error.invalid",
          failedStatus: "teamKpi.error.updateFailedStatus",
          failed: "teamKpi.error.createFailed",
        }),
      );
      setSubmitting(false);
    }
  }

  // "No" (or dismissing the prompt): keep the draft, return to where the user came from.
  function finishAsDraft() {
    navigate(backTo, { replace: true });
  }

  async function activateNow() {
    if (createdId == null) return;
    setActivating(true);
    try {
      await activateTeamKpi(createdId);
      await invalidateTeamKpi(queryClient, createdId);
      showSuccessToast(t("teamKpi.toast.activated"));
      navigate(backTo, { replace: true });
    } catch (err) {
      // The KPI stays a DRAFT — close the prompt and surface the error on the form
      // (Create is retired; the KPI is reachable from the origin list).
      setPromptClosed(true);
      setActivating(false);
      setError(
        saveErrorMessage(err, t, {
          conflict: "teamKpi.error.conflict",
          failed: "teamKpi.error.activateAfterCreateFailed",
        }),
      );
    }
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

            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}

            <Group justify="flex-end" gap="sm">
              <Button type="button" variant="default" onClick={openCancel} disabled={submitting}>
                {t("common.action.cancel")}
              </Button>
              <Button type="submit" loading={submitting} disabled={!team || createdId != null}>
                {t("common.action.create")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      {/* A MarkdownEditor form — Cancel is guarded by the discard confirm (house convention). */}
      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("teamKpi.discardTitle")}
        message={t("teamKpi.discardMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo={backTo}
      />

      {/* Post-create prompt: Yes activates the fresh draft, No (or dismiss) keeps it —
          either way the user returns to the screen they came from. */}
      <ConfirmActionModal
        opened={createdId != null && !promptClosed}
        onClose={finishAsDraft}
        title={t("teamKpi.activatePromptTitle")}
        message={t("teamKpi.activatePromptQuestion")}
        cancelLabel={t("common.state.no")}
        confirmLabel={t("common.state.yes")}
        confirmColor="green"
        onConfirm={activateNow}
        loading={activating}
      />
    </Container>
  );
}
