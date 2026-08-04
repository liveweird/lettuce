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
import {
  activateGoal,
  ApiError,
  closeGoal,
  deactivateGoal,
  deleteGoal,
  getGoal,
  getUserId,
  updateGoalDefinition,
  updateGoalProgress,
  type GoalType,
} from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import GoalCloseModal from "../components/GoalCloseModal";
import GoalDefinitionFields from "../components/GoalDefinitionFields";
import GoalHistory from "../components/GoalHistory";
import GoalProgressFields, { type GoalProgressFormValues } from "../components/GoalProgressFields";
import PersonaField from "../components/PersonaField";
import ReadOnlyField from "../components/ReadOnlyField";
import { formatIsoDate } from "../utils/datetime";
import { isGoalOverdue, OverdueBadge } from "../utils/goalValues";
import {
  goalDefinitionValidation,
  goalSaveErrorMessage,
  toDefinitionBody,
  toDefinitionFormValues,
  type GoalDefinitionFormValues,
} from "../utils/goalForm";
import { goalViewLink } from "../utils/goalLinks";
import { invalidateGoal } from "../utils/goalQueries";
import { showSuccessToast } from "../utils/toast";

/**
 * The manager's status-dependent editor on one route (the EditFeedback precedent): a DRAFT
 * renders the definition form, an ACTIVE the progress form; a CLOSED goal (nothing editable —
 * reopen it from the view screen) and any non-manager redirect to the read-only view. The
 * field blocks live in GoalDefinitionFields / GoalProgressFields (the FeedbackForm shape);
 * this route owns the branching, submission, and footers.
 */
export default function EditGoal() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "own";
  const backOverride = searchParams.get("back");
  // Bare visits fall back to the Goals page's My-goals tab (see ViewGoal); real flows pass `back`.
  const backTo = backOverride ?? "/goals";

  const [error, setError] = useState<string | null>(null);
  // Which submit is in flight — drives the pressed button's spinner while all buttons disable
  // (the FeedbackForm `submitting === "DRAFT"` idiom).
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
    queryKey: ["goal", id],
    queryFn: () => getGoal(id),
    enabled: idIsValid,
    retry: false,
  });

  const definitionForm = useForm<GoalDefinitionFormValues>({
    initialValues: { title: "", description: "", type: "NUMBER", targetValue: "", dueDate: "" },
    validate: goalDefinitionValidation(t),
  });
  const progressForm = useForm<GoalProgressFormValues>({
    initialValues: { currentValue: "", achieved: false },
    validate: {
      currentValue: (value, values) => validateProgressValue(value, values, data?.type, t),
    },
  });

  // One-shot: seed the branch's form once the document arrives (initialize no-ops afterwards).
  if (data && data.status === "DRAFT" && !definitionForm.initialized) {
    definitionForm.initialize(toDefinitionFormValues(data));
  }
  if (data && data.status === "ACTIVE" && !progressForm.initialized) {
    progressForm.initialize({
      currentValue: data.currentValue ?? "",
      achieved: data.achieved === true,
    });
  }

  if (!idIsValid) return <Navigate to={backTo} replace />;
  // Redirects to the read-only view keep the originating context (`from` / `back` override).
  const viewLink = goalViewLink(id, from, backOverride ?? undefined);
  // Only the manager edits; anyone else who can read lands on the view screen.
  if (data && getUserId() !== data.managerId) {
    return <Navigate to={viewLink} replace />;
  }
  // A CLOSED goal has nothing editable — its only action (Reopen) lives on the view screen.
  if (data && data.status === "CLOSED") {
    return <Navigate to={viewLink} replace />;
  }

  async function afterSave(successKey: string) {
    await invalidateGoal(queryClient, id);
    showSuccessToast(t(successKey));
    navigate(backTo, { replace: true });
  }

  async function saveDefinition(values: GoalDefinitionFormValues, activate = false) {
    setError(null);
    setSubmitting(activate ? "activate" : "draft");
    try {
      await updateGoalDefinition(id, toDefinitionBody(values));
      if (activate) await activateGoal(id);
      await afterSave(activate ? "goal.toast.activated" : "goal.toast.saved");
    } catch (err) {
      setError(goalSaveErrorMessage(err, t));
      setSubmitting(null);
    }
  }

  async function saveProgress(
    values: GoalProgressFormValues,
    then: "none" | "deactivate" | "close" = "none",
    summary?: string,
  ) {
    if (!data) return;
    setError(null);
    setSubmitting(then === "none" ? "progress" : then);
    try {
      await updateGoalProgress(
        id,
        data.type === "BINARY"
          ? { achieved: values.achieved }
          : { currentValue: Number(values.currentValue) },
      );
      if (then === "deactivate") {
        // Save first so no typed value is lost, then step back to draft — and stay: the
        // refetched DRAFT re-renders this route as the definition editor (the EditFeedback
        // "Accept reloads in place" precedent), which is exactly why one deactivates.
        await deactivateGoal(id);
        await invalidateGoal(queryClient, id);
        showSuccessToast(t("goal.toast.deactivated"));
        setSubmitting(null);
        return;
      }
      if (then === "close") {
        await closeGoal(id, { summary: summary ?? "" });
      }
      await afterSave(then === "close" ? "goal.toast.closed" : "goal.toast.progressSaved");
    } catch (err) {
      setError(goalSaveErrorMessage(err, t));
      setSubmitting(null);
      setCloseOpen(false);
    }
  }

  async function remove() {
    setError(null);
    setDeleting(true);
    try {
      await deleteGoal(id);
      await invalidateGoal(queryClient);
      queryClient.removeQueries({ queryKey: ["goal", id] });
      showSuccessToast(t("goal.toast.deleted"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(goalSaveErrorMessage(err, t));
      setDeleting(false);
      closeDelete();
    }
  }

  const errorStatus = fetchError instanceof ApiError ? fetchError.status : null;
  const loadErrorMessage =
    errorStatus === 404
      ? t("goal.error.notFound")
      : errorStatus === 403
        ? t("goal.error.viewPermission")
        : t("goal.error.loadFailed");

  const isDraft = data?.status === "DRAFT";
  const typeChanged = isDraft && data != null && definitionForm.values.type !== data.type;

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{isDraft ? t("goal.editTitle") : t("goal.editProgressTitle")}</Title>
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
                  <PersonaField label={t("goal.manager")} you />
                  <PersonaField label={t("goal.subordinate")} name={data.subordinateName} />
                </Group>

                <Tabs defaultValue="content" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("goal.history")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="content" pt="md">
                    <GoalDefinitionFields form={definitionForm} typeChangeWarning={typeChanged} />
                  </Tabs.Panel>

                  <Tabs.Panel value="history" pt="md">
                    <GoalHistory goalId={id} />
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
                      {t("goal.action.saveDraft")}
                    </Button>
                    <Button
                      type="button"
                      // Runs the form validation first (calling the onSubmit handler with no
                      // event), then saves and activates in one go — the "Save & send" pattern.
                      onClick={() => definitionForm.onSubmit((values) => saveDefinition(values, true))()}
                      loading={submitting === "activate"}
                      disabled={submitting !== null || deleting}
                    >
                      {t("goal.action.saveAndActivate")}
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </form>
          ) : data ? (
            <form onSubmit={progressForm.onSubmit((values) => saveProgress(values))} noValidate>
              <Stack>
                <Group gap="xl">
                  <PersonaField label={t("goal.manager")} you />
                  <PersonaField label={t("goal.subordinate")} name={data.subordinateName} />
                  <ReadOnlyField label={t("goal.type.label")}>
                    <Text size="sm">{t(`goal.type.${data.type}`)}</Text>
                  </ReadOnlyField>
                  {/* The due date is DRAFT-only editable — here (ACTIVE) it is a fixed fact. */}
                  <ReadOnlyField label={t("goal.dueDate")}>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm">{formatIsoDate(data.dueDate, i18n.language)}</Text>
                      {isGoalOverdue(data.status, data.dueDate) && <OverdueBadge />}
                    </Group>
                  </ReadOnlyField>
                </Group>

                <Tabs defaultValue="content" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("goal.history")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="content" pt="md">
                    <GoalProgressFields goal={data} form={progressForm} locale={i18n.language} />
                  </Tabs.Panel>

                  <Tabs.Panel value="history" pt="md">
                    <GoalHistory goalId={id} />
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
                    {t("goal.action.deactivate")}
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
                      {t("goal.action.saveAndClose")}
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
        title={t("goal.discardTitle")}
        message={t("goal.discardMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo={backTo}
      />
      <ConfirmActionModal
        opened={deleteOpen}
        onClose={closeDelete}
        title={t("goal.deleteTitle")}
        message={t("goal.deleteMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("common.action.delete")}
        loading={deleting}
        onConfirm={remove}
      />
      <GoalCloseModal
        opened={closeOpen}
        onClose={() => setCloseOpen(false)}
        loading={submitting === "close"}
        onConfirm={(summary) => void saveProgress(progressForm.values, "close", summary)}
      />
    </Container>
  );
}

// The ACTIVE progress rule for the numeric types (BINARY's Switch needs no validation).
function validateProgressValue(
  value: number | string,
  _values: GoalProgressFormValues,
  type: GoalType | undefined,
  t: (key: string) => string,
): string | null {
  if (type == null || type === "BINARY") return null;
  if (value === "" || value == null || !Number.isFinite(Number(value))) {
    return t("goal.validation.currentRequired");
  }
  if (type === "PERCENTAGE" && (Number(value) < 0 || Number(value) > 100)) {
    return t("goal.validation.percentageRange");
  }
  return null;
}
