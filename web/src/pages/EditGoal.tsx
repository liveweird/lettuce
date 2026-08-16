import type { ParseKeys, TFunction } from "i18next";
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
import { getUserId, hasFeature } from "../api/session";
import { activateGoal, deleteGoal, getGoal, updateGoalDefinition, updateGoalProgress, type GoalType } from "../api/goals";
import ConfirmActionModal from "../components/ConfirmActionModal";
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
 * The status-dependent editor on one route (the EditFeedback precedent): a DRAFT renders the
 * manager's definition form; an ACTIVE renders the Update screen (v2.8.0) — the progress value
 * plus an optional history comment, open to BOTH parties (progress is the pair's shared
 * write). An ARCHIVED goal (nothing editable — reopen it from the view screen), a non-manager
 * on a DRAFT, and a non-party on an ACTIVE all redirect to the read-only view. The field
 * blocks live in GoalDefinitionFields / GoalProgressFields (the FeedbackForm shape); this
 * route owns the branching, submission, and footers. Lifecycle actions live on the list rows
 * and the view screen, not here.
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
  const [submitting, setSubmitting] = useState<"draft" | "activate" | "progress" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);
  const [deleteOpen, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  // The Update screen's "nothing to save" notice — auto-hides once the form goes dirty.
  const [nothingToSave, setNothingToSave] = useState(false);

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
    initialValues: {
      title: "",
      description: "",
      type: "NUMBER",
      targetValue: "",
      milestones: [],
      dueDate: "",
    },
    validate: goalDefinitionValidation(t),
  });
  const progressForm = useForm<GoalProgressFormValues>({
    initialValues: { currentValue: "", milestones: [], comment: "" },
    validate: {
      currentValue: (value, values) =>
        validateProgressValue(value, values, data?.type, data?.currentValue != null, t),
    },
  });

  // One-shot: seed the branch's form once the document arrives (initialize no-ops afterwards).
  if (data && data.status === "DRAFT" && !definitionForm.initialized) {
    definitionForm.initialize(toDefinitionFormValues(data));
  }
  if (data && data.status === "ACTIVE" && !progressForm.initialized) {
    progressForm.initialize({
      currentValue: data.currentValue ?? "",
      milestones: data.milestones.map((m) => ({ id: m.id, description: m.description, done: m.done })),
      comment: "",
    });
  }

  const currentUserId = getUserId();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("GOALS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={backTo} replace />;
  // Redirects to the read-only view keep the originating context (`from` / `back` override).
  const viewLink = goalViewLink(id, from, backOverride ?? undefined);
  // DRAFT: only the manager edits the definition. ACTIVE: both parties update progress
  // (v2.8.0). Anyone else who can read lands on the view screen.
  if (data && data.status === "DRAFT" && currentUserId !== data.managerId) {
    return <Navigate to={viewLink} replace />;
  }
  if (
    data &&
    data.status === "ACTIVE" &&
    currentUserId !== data.managerId &&
    currentUserId !== data.subordinateId
  ) {
    return <Navigate to={viewLink} replace />;
  }
  // An ARCHIVED goal has nothing editable — its only action (Reopen) lives on the view screen.
  if (data && data.status === "ARCHIVED") {
    return <Navigate to={viewLink} replace />;
  }

  async function afterSave(successKey: ParseKeys) {
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

  async function saveProgress(values: GoalProgressFormValues) {
    if (!data) return;
    // Nothing changed (neither the value nor a comment) — tell the user instead of firing a
    // no-op PUT; the notice hides again the moment the form goes dirty.
    if (!progressForm.isDirty()) {
      setNothingToSave(true);
      return;
    }
    setError(null);
    setSubmitting("progress");
    try {
      const comment = values.comment.trim() ? values.comment : undefined;
      await updateGoalProgress(
        id,
        data.type === "PLAN"
          ? {
              // The complete done-state — but only when a checkbox was actually touched: an
              // untouched list makes this a comment-only update (the server treats an
              // unchanged list the same way, so this just keeps the payload minimal).
              milestones: progressForm.isDirty("milestones")
                ? values.milestones.map((m) => ({ id: m.id, done: m.done }))
                : undefined,
              comment,
            }
          : {
              // An empty input is only submittable while the goal has no recorded value
              // (validated) — omit the field then, don't send Number("") === 0.
              currentValue: values.currentValue === "" ? undefined : Number(values.currentValue),
              comment,
            },
      );
      await afterSave("goal.toast.progressSaved");
    } catch (err) {
      setError(goalSaveErrorMessage(err, t));
      setSubmitting(null);
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
                  {/* Either party may be here now (v2.8.0) — "You" follows the caller. */}
                  <PersonaField
                    label={t("goal.manager")}
                    name={data.managerName}
                    you={currentUserId === data.managerId}
                  />
                  <PersonaField
                    label={t("goal.subordinate")}
                    name={data.subordinateName}
                    you={currentUserId === data.subordinateId}
                  />
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
                {/* Save with no changes: a notice, not an error — hides once the form is dirty. */}
                {nothingToSave && !progressForm.isDirty() && (
                  <Alert color="gray" variant="light">
                    {t("goal.progress.nothingToSave")}
                  </Alert>
                )}

                {/* Lifecycle actions live on the list and the view screen — this screen only
                    updates progress. Close confirms only when there are unsaved changes (the
                    EditPerformanceReview dirty-aware pattern). */}
                <Group justify="flex-end" gap="sm">
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => (progressForm.isDirty() ? openCancel() : navigate(backTo))}
                    disabled={submitting !== null}
                  >
                    {t("common.action.close")}
                  </Button>
                  <Button
                    type="submit"
                    loading={submitting === "progress"}
                    disabled={submitting !== null}
                  >
                    {t("common.action.save")}
                  </Button>
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
    </Container>
  );
}

// The ACTIVE progress rule for the numeric types (PLAN's checkboxes need no validation).
// v2.8.1: an empty input is allowed while the goal has no recorded value yet (the field is
// simply omitted — a comment-only update); once a value exists it can never be unset.
function validateProgressValue(
  value: number | string,
  _values: GoalProgressFormValues,
  type: GoalType | undefined,
  hasRecordedValue: boolean,
  t: TFunction,
): string | null {
  if (type == null || type === "PLAN") return null;
  if (value === "" || value == null) {
    return hasRecordedValue ? t("goal.validation.currentRequired") : null;
  }
  if (!Number.isFinite(Number(value))) {
    return t("goal.validation.currentRequired");
  }
  if (type === "PERCENTAGE" && (Number(value) < 0 || Number(value) > 100)) {
    return t("goal.validation.percentageRange");
  }
  return null;
}
