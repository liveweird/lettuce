import { lazy, Suspense, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  activateTeamKpi,
  ApiError,
  closeTeamKpi,
  deactivateTeamKpi,
  deleteTeamKpi,
  getTeamKpi,
  getUserId,
  updateTeamKpiDefinition,
  updateTeamKpiProgress,
  type TeamKpiType,
} from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import GoalCloseModal from "../components/GoalCloseModal";
import ReadOnlyField from "../components/ReadOnlyField";
import TeamKpiDefinitionFields from "../components/TeamKpiDefinitionFields";
import TeamKpiHistory from "../components/TeamKpiHistory";
import TeamKpiProgressFields, { type TeamKpiProgressFormValues } from "../components/TeamKpiProgressFields";
import {
  teamKpiDefinitionValidation,
  teamKpiSaveErrorMessage,
  toKpiDefinitionBody,
  toKpiDefinitionFormValues,
  type TeamKpiDefinitionFormValues,
} from "../utils/teamKpiForm";
import { todayIsoDate } from "../utils/datetime";
import { teamKpiViewLink } from "../utils/teamKpiLinks";
import { invalidateTeamKpi } from "../utils/teamKpiQueries";

// The chart is the only @mantine/charts (recharts) consumer — lazy so the libraries stay out of
// the main bundle (the ViewTeamKpi pattern; both routes share the one chunk).
const TeamKpiChart = lazy(() => import("../components/TeamKpiChart"));

/**
 * The manager's status-dependent editor on one route (the EditGoal precedent): a DRAFT renders
 * the definition form, an ACTIVE the progress form; a CLOSED KPI (nothing editable — reopen it
 * from the view screen) and any non-manager redirect to the read-only view. The field blocks
 * live in TeamKpiDefinitionFields / TeamKpiProgressFields; this route owns the branching,
 * submission, and footers.
 */
export default function EditTeamKpi() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const backOverride = searchParams.get("back");
  const backTo = backOverride ?? "/team-kpis?tab=managed";

  const [error, setError] = useState<string | null>(null);
  // Which submit is in flight — drives the pressed button's spinner while all buttons disable.
  const [submitting, setSubmitting] = useState<
    "draft" | "activate" | "progress" | "deactivate" | "close" | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);
  const [deleteOpen, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const {
    data,
    isLoading,
    isError,
    error: fetchError,
  } = useQuery({
    queryKey: ["teamKpi", id],
    queryFn: () => getTeamKpi(id),
    enabled: idIsValid,
    retry: false,
  });

  const definitionForm = useForm<TeamKpiDefinitionFormValues>({
    initialValues: { title: "", description: "", type: "NUMBER", targetValue: "" },
    validate: teamKpiDefinitionValidation(t),
  });
  const progressForm = useForm<TeamKpiProgressFormValues>({
    initialValues: { currentValue: "", date: todayIsoDate() },
    validate: {
      currentValue: (value) => validateProgressValue(value, data?.type, t),
      date: (value) => validateProgressDate(value, t),
    },
  });

  // One-shot: seed the branch's form once the document arrives (initialize no-ops afterwards).
  if (data && data.status === "DRAFT" && !definitionForm.initialized) {
    definitionForm.initialize(toKpiDefinitionFormValues(data));
  }
  if (data && data.status === "ACTIVE" && !progressForm.initialized) {
    // The date deliberately seeds to today, not currentValueDate — a fresh recording defaults
    // to "measured now" and backdating is the explicit choice.
    progressForm.initialize({ currentValue: data.currentValue, date: todayIsoDate() });
  }

  if (!idIsValid) return <Navigate to={backTo} replace />;
  // Redirects to the read-only view keep the originating context (`back` override).
  const viewLink = teamKpiViewLink(id, backOverride ?? undefined);
  // Only the team's current manager edits; anyone else who can read lands on the view screen.
  if (data && getUserId() !== data.managerId) {
    return <Navigate to={viewLink} replace />;
  }
  // A CLOSED KPI has nothing editable — its only action (Reopen) lives on the view screen.
  if (data && data.status === "CLOSED") {
    return <Navigate to={viewLink} replace />;
  }

  async function afterSave() {
    await invalidateTeamKpi(queryClient, id);
    navigate(backTo, { replace: true });
  }

  async function saveDefinition(values: TeamKpiDefinitionFormValues, activate = false) {
    setError(null);
    setSubmitting(activate ? "activate" : "draft");
    try {
      await updateTeamKpiDefinition(id, toKpiDefinitionBody(values));
      if (activate) await activateTeamKpi(id);
      await afterSave();
    } catch (err) {
      setError(teamKpiSaveErrorMessage(err, t));
      setSubmitting(null);
    }
  }

  async function saveProgress(
    values: TeamKpiProgressFormValues,
    then: "none" | "deactivate" | "close" = "none",
    summary?: string,
  ) {
    if (!data) return;
    setError(null);
    setSubmitting(then === "none" ? "progress" : then);
    try {
      await updateTeamKpiProgress(id, { currentValue: Number(values.currentValue), date: values.date });
      if (then === "deactivate") {
        // Save first so no typed value is lost, then step back to draft — and stay: the
        // refetched DRAFT re-renders this route as the definition editor (the EditGoal
        // precedent), which is exactly why one deactivates.
        await deactivateTeamKpi(id);
        await invalidateTeamKpi(queryClient, id);
        setSubmitting(null);
        return;
      }
      if (then === "close") {
        await closeTeamKpi(id, { summary: summary ?? "" });
      }
      await afterSave();
    } catch (err) {
      setError(teamKpiSaveErrorMessage(err, t));
      setSubmitting(null);
      setCloseOpen(false);
    }
  }

  async function remove() {
    setError(null);
    setDeleting(true);
    try {
      await deleteTeamKpi(id);
      await invalidateTeamKpi(queryClient);
      queryClient.removeQueries({ queryKey: ["teamKpi", id] });
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(teamKpiSaveErrorMessage(err, t));
      setDeleting(false);
      closeDelete();
    }
  }

  const errorStatus = fetchError instanceof ApiError ? fetchError.status : null;
  const loadErrorMessage =
    errorStatus === 404
      ? t("teamKpi.error.notFound")
      : errorStatus === 403
        ? t("teamKpi.error.viewPermission")
        : t("teamKpi.error.loadFailed");

  const isDraft = data?.status === "DRAFT";
  const typeChanged = isDraft && data != null && definitionForm.values.type !== data.type;

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{isDraft ? t("teamKpi.editTitle") : t("teamKpi.editProgressTitle")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {loadErrorMessage}
              </Alert>
              <Group justify="flex-end">
                <Button variant="default" onClick={() => navigate(backTo)}>
                  {t("common.action.close")}
                </Button>
              </Group>
            </>
          ) : data && isDraft ? (
            <form onSubmit={definitionForm.onSubmit((values) => saveDefinition(values))} noValidate>
              <Stack>
                <Group gap="xl">
                  <ReadOnlyField label={t("teamKpi.team")}>
                    <Text size="sm" fw={500}>
                      {data.teamName}
                    </Text>
                  </ReadOnlyField>
                  <ReadOnlyField label={t("teamKpi.manager")}>
                    <Text size="sm">{t("common.state.you")}</Text>
                  </ReadOnlyField>
                </Group>

                <Tabs defaultValue="content" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("teamKpi.history")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="content" pt="md">
                    <TeamKpiDefinitionFields form={definitionForm} typeChangeWarning={typeChanged} />
                  </Tabs.Panel>

                  <Tabs.Panel value="history" pt="md">
                    <TeamKpiHistory kpiId={id} />
                  </Tabs.Panel>
                </Tabs>

                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}

                <Group justify="space-between" gap="sm">
                  <Button
                    color="red"
                    variant="light"
                    onClick={openDelete}
                    disabled={submitting !== null || deleting}
                  >
                    {t("common.action.delete")}
                  </Button>
                  <Group gap="sm">
                    <Button
                      type="button"
                      variant="default"
                      onClick={openCancel}
                      disabled={submitting !== null || deleting}
                    >
                      {t("common.action.cancel")}
                    </Button>
                    <Button
                      type="submit"
                      variant="light"
                      loading={submitting === "draft"}
                      disabled={submitting !== null || deleting}
                    >
                      {t("teamKpi.action.saveDraft")}
                    </Button>
                    <Button
                      type="button"
                      // Runs the form validation first (calling the onSubmit handler with no
                      // event), then saves and activates in one go — the "Save & send" pattern.
                      onClick={() => definitionForm.onSubmit((values) => saveDefinition(values, true))()}
                      loading={submitting === "activate"}
                      disabled={submitting !== null || deleting}
                    >
                      {t("teamKpi.action.saveAndActivate")}
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </form>
          ) : data ? (
            <form onSubmit={progressForm.onSubmit((values) => saveProgress(values))} noValidate>
              <Stack>
                <Group gap="xl">
                  <ReadOnlyField label={t("teamKpi.team")}>
                    <Text size="sm" fw={500}>
                      {data.teamName}
                    </Text>
                  </ReadOnlyField>
                  <ReadOnlyField label={t("teamKpi.manager")}>
                    <Text size="sm">{t("common.state.you")}</Text>
                  </ReadOnlyField>
                  <ReadOnlyField label={t("teamKpi.type.label")}>
                    <Text size="sm">{t(`teamKpi.type.${data.type}`)}</Text>
                  </ReadOnlyField>
                </Group>

                <Tabs defaultValue="content" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                    <Tabs.Tab value="graph">{t("teamKpi.graph")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("teamKpi.history")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="content" pt="md">
                    <TeamKpiProgressFields kpi={data} form={progressForm} locale={i18n.language} />
                  </Tabs.Panel>

                  <Tabs.Panel value="graph" pt="md">
                    <Suspense fallback={<Skeleton height={280} radius="sm" />}>
                      <TeamKpiChart kpi={data} />
                    </Suspense>
                  </Tabs.Panel>

                  <Tabs.Panel value="history" pt="md">
                    <TeamKpiHistory kpiId={id} />
                  </Tabs.Panel>
                </Tabs>

                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}

                {/* No discard confirm: a one-field progress tweak isn't a long-form editor. */}
                <Group justify="space-between" gap="sm">
                  <Button
                    type="button"
                    variant="light"
                    // Validated like the other submits; saves the progress before stepping back.
                    onClick={() => progressForm.onSubmit((values) => saveProgress(values, "deactivate"))()}
                    loading={submitting === "deactivate"}
                    disabled={submitting !== null}
                  >
                    {t("teamKpi.action.deactivate")}
                  </Button>
                  <Group gap="sm">
                    <Button
                      type="button"
                      variant="default"
                      onClick={() => navigate(backTo)}
                      disabled={submitting !== null}
                    >
                      {t("common.action.cancel")}
                    </Button>
                    <Button
                      type="submit"
                      variant="light"
                      loading={submitting === "progress"}
                      disabled={submitting !== null}
                    >
                      {t("common.action.save")}
                    </Button>
                    <Button
                      type="button"
                      // Validate first, then collect the mandatory summary in the close dialog.
                      onClick={() => progressForm.onSubmit(() => setCloseOpen(true))()}
                      loading={submitting === "close"}
                      disabled={submitting !== null}
                    >
                      {t("teamKpi.action.saveAndClose")}
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </form>
          ) : null}
        </Stack>
      </Paper>

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("teamKpi.discardTitle")}
        message={t("teamKpi.discardMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo={backTo}
      />
      <ConfirmActionModal
        opened={deleteOpen}
        onClose={closeDelete}
        title={t("teamKpi.deleteTitle")}
        message={t("teamKpi.deleteMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("common.action.delete")}
        loading={deleting}
        onConfirm={remove}
      />
      <GoalCloseModal
        opened={closeOpen}
        onClose={() => setCloseOpen(false)}
        loading={submitting === "close"}
        keyPrefix="teamKpi"
        onConfirm={(summary) => void saveProgress(progressForm.values, "close", summary)}
      />
    </Container>
  );
}

// The ACTIVE progress rule (mirrors the server: always required; 0–100 for PERCENTAGE).
function validateProgressValue(
  value: number | string,
  type: TeamKpiType | undefined,
  t: (key: string) => string,
): string | null {
  if (value === "" || value == null || !Number.isFinite(Number(value))) {
    return t("teamKpi.validation.currentRequired");
  }
  if (type === "PERCENTAGE" && (Number(value) < 0 || Number(value) > 100)) {
    return t("teamKpi.validation.percentageRange");
  }
  return null;
}

// The value-date rule (mirrors the server: required; today or the past, never the future —
// ISO strings compare chronologically, the goalForm due-date idiom inverted).
function validateProgressDate(value: string, t: (key: string) => string): string | null {
  if (!value) return t("teamKpi.validation.dateRequired");
  if (value > todayIsoDate()) return t("teamKpi.validation.dateInFuture");
  return null;
}
