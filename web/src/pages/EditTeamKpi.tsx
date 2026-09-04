import { useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, Center, Container, Loader, Paper, Stack, Tabs, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { hasFeature } from "../api/session";
import { activateTeamKpi, deleteTeamKpi, getTeamKpi, updateTeamKpiDefinition } from "../api/teamkpis";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DiscardGuard from "../components/DiscardGuard";
import FormFooter from "../components/FormFooter";
import MetaStrip from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import TeamKpiDefinitionFields from "../components/TeamKpiDefinitionFields";
import TeamKpiHistory from "../components/TeamKpiHistory";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
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

  // The one cancel guard (v3.5.0) — the definition has no list operations, so `isDirty` is exact.
  const { requestCancel, guardProps } = useDiscardGuard({
    isDirty: () => definitionForm.isDirty(),
    to: backTo,
    title: t("teamKpi.discardTitle"),
    message: t("teamKpi.discardMessage"),
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
    <>
      <PageHeader title={t("teamKpi.editTitle")} mb="lg" />
      <Container size="md" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <Stack>
            {isLoading ? (
              <Center py="xl">
                <Loader />
              </Center>
            ) : isError ? (
              <>
                <Alert color="red" variant="light">
                  {loadErrorMessage}
                </Alert>
                <FormFooter>
                  <Button variant="default" onClick={() => navigate(backTo)}>
                    {t("common.action.close")}
                  </Button>
                </FormFooter>
              </>
            ) : data ? (
              <form onSubmit={definitionForm.onSubmit((values) => saveDefinition(values))} noValidate>
                <Stack>
                  {/* The context line (v3.5.0): the team and its manager (the caller). */}
                  <MetaStrip
                    items={[
                      {
                        key: "team",
                        label: t("teamKpi.team"),
                        value: (
                          <Text size="sm" fw={500}>
                            {data.teamName}
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

                  <FormFooter>
                    <Button
                      color="red"
                      variant="light"
                      mr="auto"
                      onClick={openDelete}
                      disabled={submitting !== null || deleting}
                    >
                      {t("common.action.delete")}
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      onClick={requestCancel}
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
                  </FormFooter>
                </Stack>
              </form>
            ) : null}
          </Stack>
        </Paper>
      </Container>

      <DiscardGuard {...guardProps} />
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
    </>
  );
}
