import { useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { hasFeature } from "../api/session";
import { activateTeamKpi, deleteTeamKpi, getTeamKpi, updateTeamKpiDefinition } from "../api/teamkpis";
import ConfirmActionModal from "../components/ConfirmActionModal";
import ReadOnlyField from "../components/ReadOnlyField";
import TeamKpiDefinitionFields from "../components/TeamKpiDefinitionFields";
import TeamKpiHistory from "../components/TeamKpiHistory";
import {
  teamKpiDefinitionValidation,
  teamKpiSaveErrorMessage,
  toKpiDefinitionBody,
  toKpiDefinitionFormValues,
  type TeamKpiDefinitionFormValues,
} from "../utils/teamKpiForm";
import { teamKpiViewLink } from "../utils/teamKpiLinks";
import { invalidateTeamKpi } from "../utils/teamKpiQueries";
import { showSuccessToast } from "../utils/toast";
import { safeBackParam } from "../utils/url";

/**
 * The manager's DRAFT definition editor (reached from the view screen's Edit link). Everything
 * else — data points, graph, lifecycle actions — lives on the view screen (v1.29.0), so a
 * non-DRAFT KPI and any non-manager redirect there.
 */
export default function EditTeamKpi() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const backOverride = safeBackParam(searchParams);
  const backTo = backOverride ?? "/team-kpis?tab=managed";

  const [error, setError] = useState<string | null>(null);
  // Which submit is in flight — drives the pressed button's spinner while all buttons disable.
  const [submitting, setSubmitting] = useState<"draft" | "activate" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);
  const [deleteOpen, { open: openDelete, close: closeDelete }] = useDisclosure(false);

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
    initialValues: { title: "", description: "", type: "NUMBER", targetValue: "", targetDirection: "AT_LEAST" },
    validate: teamKpiDefinitionValidation(t),
  });

  // One-shot: seed the form once the document arrives (initialize no-ops afterwards).
  if (data && data.status === "DRAFT" && !definitionForm.initialized) {
    definitionForm.initialize(toKpiDefinitionFormValues(data));
  }

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("TEAM_KPIS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={backTo} replace />;
  // Only a caller with the manage capability (the team's manager or their chain — v2.26.0)
  // edits, and only a DRAFT has an editable definition — everyone and everything else lands
  // on the view screen (which keeps the `back` override). Suppressed while a submit is in
  // flight: Save & activate refetches the KPI as ACTIVE (invalidateTeamKpi awaits the
  // document) before saveDefinition navigates to backTo, and this redirect must not win that
  // race.
  if (data && (!data.canManage || data.status !== "DRAFT") && submitting === null) {
    return <Navigate to={teamKpiViewLink(id, backOverride ?? undefined)} replace />;
  }

  async function saveDefinition(values: TeamKpiDefinitionFormValues, activate = false) {
    setError(null);
    setSubmitting(activate ? "activate" : "draft");
    try {
      await updateTeamKpiDefinition(id, toKpiDefinitionBody(values));
      if (activate) await activateTeamKpi(id);
      await invalidateTeamKpi(queryClient, id);
      showSuccessToast(t(activate ? "teamKpi.toast.activated" : "teamKpi.toast.saved"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(teamKpiSaveErrorMessage(err, t));
      setSubmitting(null);
    }
  }

  async function remove() {
    setError(null);
    setDeleting(true);
    try {
      await deleteTeamKpi(id);
      await invalidateTeamKpi(queryClient);
      queryClient.removeQueries({ queryKey: ["teamKpi", id] });
      showSuccessToast(t("teamKpi.toast.deleted"));
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

  const typeChanged = data != null && definitionForm.values.type !== data.type;

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("teamKpi.editTitle")}</Title>
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
          ) : data ? (
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
                    <TeamKpiHistory kpiId={id} type={data.type} />
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
    </Container>
  );
}
