import { lazy, Suspense, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Center,
  Container,
  Group,
  Input,
  Loader,
  NumberInput,
  Paper,
  Select,
  Skeleton,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  deleteGoal,
  getGoal,
  getUserId,
  updateGoalDefinition,
  updateGoalProgress,
  type GoalType,
} from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import GoalHistory from "../components/GoalHistory";
import PersonaField from "../components/PersonaField";
import {
  goalDefinitionValidation,
  goalSaveErrorMessage,
  MAX_GOAL_TEXT_LENGTH,
  MAX_GOAL_TITLE_LENGTH,
  toDefinitionBody,
  toDefinitionFormValues,
  type GoalDefinitionFormValues,
} from "../utils/goalForm";
import { formatGoalValue } from "../utils/goalValues";

// ~0.5 MB of MDXEditor — loaded only when the DRAFT definition branch actually renders.
const MarkdownEditor = lazy(() => import("../components/MarkdownEditor"));

interface ProgressFormValues {
  currentValue: number | string;
  achieved: boolean;
}

/**
 * The manager's status-dependent editor on one route (the EditFeedback precedent): a DRAFT
 * renders the definition form, an ACTIVE the progress form; a CLOSED goal (nothing editable —
 * reopen it from the view screen) and any non-manager redirect to the read-only view.
 */
export default function EditGoal() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "own";
  const backOverride = searchParams.get("back");
  // No /goals tab page exists yet — bare visits fall back to the dashboard (see ViewGoal).
  const backTo = backOverride ?? "/";

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
    queryKey: ["goal", id],
    queryFn: () => getGoal(id),
    enabled: idIsValid,
    retry: false,
  });

  const definitionForm = useForm<GoalDefinitionFormValues>({
    initialValues: { title: "", description: "", type: "NUMBER", targetValue: "" },
    validate: goalDefinitionValidation(t),
  });
  const progressForm = useForm<ProgressFormValues>({
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
  const viewSearch = `?from=${from}${backOverride ? `&back=${encodeURIComponent(backOverride)}` : ""}`;
  // Only the manager edits; anyone else who can read lands on the view screen.
  if (data && getUserId() !== data.managerId) {
    return <Navigate to={`/goals/${id}/view${viewSearch}`} replace />;
  }
  // A CLOSED goal has nothing editable — its only action (Reopen) lives on the view screen.
  if (data && data.status === "CLOSED") {
    return <Navigate to={`/goals/${id}/view${viewSearch}`} replace />;
  }

  async function afterSave() {
    await queryClient.invalidateQueries({ queryKey: ["goals"] });
    await queryClient.invalidateQueries({ queryKey: ["goal", id] });
    queryClient.invalidateQueries({ queryKey: ["goalEvents", id] });
    navigate(backTo, { replace: true });
  }

  async function saveDefinition(values: GoalDefinitionFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await updateGoalDefinition(id, toDefinitionBody(values));
      await afterSave();
    } catch (err) {
      setError(goalSaveErrorMessage(err, t));
      setSubmitting(false);
    }
  }

  async function saveProgress(values: ProgressFormValues) {
    if (!data) return;
    setError(null);
    setSubmitting(true);
    try {
      await updateGoalProgress(
        id,
        data.type === "BINARY"
          ? { achieved: values.achieved }
          : { currentValue: Number(values.currentValue) },
      );
      await afterSave();
    } catch (err) {
      setError(goalSaveErrorMessage(err, t));
      setSubmitting(false);
    }
  }

  async function remove() {
    setError(null);
    setDeleting(true);
    try {
      await deleteGoal(id);
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.removeQueries({ queryKey: ["goal", id] });
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
            <form onSubmit={definitionForm.onSubmit(saveDefinition)} noValidate>
              <Stack>
                <Group gap="xl">
                  <PersonaField label={t("goal.manager")} you />
                  <PersonaField label={t("goal.subordinate")} name={data.subordinateName ?? undefined} />
                </Group>

                <Tabs defaultValue="content" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("goal.history")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="content" pt="md">
                    <Stack gap="lg">
                      <TextInput
                        label={t("goal.title")}
                        maxLength={MAX_GOAL_TITLE_LENGTH}
                        withAsterisk
                        {...definitionForm.getInputProps("title")}
                      />
                      <Stack gap={4}>
                        <Suspense fallback={<Skeleton height={220} radius="sm" />}>
                          <MarkdownEditor
                            label={t("goal.description")}
                            value={definitionForm.values.description}
                            onChange={(md) => definitionForm.setFieldValue("description", md)}
                            maxLength={MAX_GOAL_TEXT_LENGTH}
                          />
                        </Suspense>
                        {definitionForm.errors.description && (
                          <Text size="sm" c="red">
                            {definitionForm.errors.description}
                          </Text>
                        )}
                      </Stack>
                      <Group gap="xl" align="flex-start">
                        <Select
                          label={t("goal.type.label")}
                          data={(["BINARY", "NUMBER", "PERCENTAGE"] as const).map((type) => ({
                            value: type,
                            label: t(`goal.type.${type}`),
                          }))}
                          allowDeselect={false}
                          w={200}
                          {...definitionForm.getInputProps("type")}
                        />
                        {definitionForm.values.type !== "BINARY" && (
                          <NumberInput
                            label={t("goal.target")}
                            withAsterisk
                            w={200}
                            min={definitionForm.values.type === "PERCENTAGE" ? 0 : undefined}
                            max={definitionForm.values.type === "PERCENTAGE" ? 100 : undefined}
                            suffix={definitionForm.values.type === "PERCENTAGE" ? "%" : undefined}
                            {...definitionForm.getInputProps("targetValue")}
                          />
                        )}
                      </Group>
                      {typeChanged && (
                        <Text size="sm" c="orange">
                          {t("goal.typeChangeWarning")}
                        </Text>
                      )}
                    </Stack>
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

                <Group justify="space-between">
                  <Button color="red" variant="light" onClick={openDelete} disabled={submitting}>
                    {t("common.action.delete")}
                  </Button>
                  <Group gap="sm">
                    <Button type="button" variant="default" onClick={openCancel} disabled={submitting}>
                      {t("common.action.cancel")}
                    </Button>
                    <Button type="submit" loading={submitting}>
                      {t("common.action.save")}
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </form>
          ) : data ? (
            <form onSubmit={progressForm.onSubmit(saveProgress)} noValidate>
              <Stack>
                <Group gap="xl">
                  <PersonaField label={t("goal.manager")} you />
                  <PersonaField label={t("goal.subordinate")} name={data.subordinateName ?? undefined} />
                  <Input.Wrapper label={t("goal.type.label")}>
                    <Box mih={36} display="flex" style={{ alignItems: "center" }}>
                      <Text size="sm">{t(`goal.type.${data.type}`)}</Text>
                    </Box>
                  </Input.Wrapper>
                </Group>

                <Tabs defaultValue="content" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("goal.history")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="content" pt="md">
                    <Stack gap="lg">
                      {/* The definition is frozen while ACTIVE (deactivate to edit it) — only
                          the current value is live. */}
                      <Input.Wrapper label={t("goal.title")}>
                        <Text fw={500}>{data.title}</Text>
                      </Input.Wrapper>
                      {data.type === "BINARY" ? (
                        <Switch
                          label={t("goal.achieved")}
                          checked={progressForm.values.achieved}
                          onChange={(event) =>
                            progressForm.setFieldValue("achieved", event.currentTarget.checked)
                          }
                        />
                      ) : (
                        <Group gap="xl" align="flex-start">
                          <Input.Wrapper label={t("goal.target")}>
                            <Box mih={36} display="flex" style={{ alignItems: "center" }}>
                              <Text size="sm">
                                {formatGoalValue(data.type, data.targetValue, i18n.language)}
                              </Text>
                            </Box>
                          </Input.Wrapper>
                          <NumberInput
                            label={t("goal.current")}
                            withAsterisk
                            w={200}
                            min={data.type === "PERCENTAGE" ? 0 : undefined}
                            max={data.type === "PERCENTAGE" ? 100 : undefined}
                            suffix={data.type === "PERCENTAGE" ? "%" : undefined}
                            {...progressForm.getInputProps("currentValue")}
                          />
                        </Group>
                      )}
                    </Stack>
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
                <Group justify="flex-end" gap="sm">
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => navigate(backTo)}
                    disabled={submitting}
                  >
                    {t("common.action.cancel")}
                  </Button>
                  <Button type="submit" loading={submitting}>
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

// The ACTIVE progress rule for the numeric types (BINARY's Switch needs no validation).
function validateProgressValue(
  value: number | string,
  _values: ProgressFormValues,
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
