import { lazy, Suspense, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Container,
  Group,
  NumberInput,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { createGoal, listTeamMembers } from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import PersonaField from "../components/PersonaField";
import {
  goalDefinitionValidation,
  MAX_GOAL_TEXT_LENGTH,
  MAX_GOAL_TITLE_LENGTH,
  toDefinitionBody,
  type GoalDefinitionFormValues,
} from "../utils/goalForm";
import { saveErrorMessage } from "../utils/saveError";

// ~0.5 MB of MDXEditor — loaded only when this create screen actually renders.
const MarkdownEditor = lazy(() => import("../components/MarkdownEditor"));

// Default cancel target when no `back` param is present: the subordinates grid, the only
// entry point that links here today.
const BACK_TO = "/?tab=subordinates";
const PICKER_PAGE_SIZE = 100;

/**
 * The manager's goal-create screen: pick (or arrive with) a direct report, define the goal —
 * the same definition fields the DRAFT editor offers — and Create. The goal always lands as
 * DRAFT; on success the manager lands in its DRAFT editor (the 1:1-creation pattern — whoever
 * can edit goes straight to edit mode), where Save & activate is one click away.
 */
export default function CreateGoal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const preselectedId = Number(searchParams.get("subordinateId"));
  const preselected = Number.isFinite(preselectedId) && preselectedId > 0;
  const subordinateName = searchParams.get("subordinateName");
  const backParam = searchParams.get("back");
  const backTo = backParam ?? BACK_TO;

  const [subordinate, setSubordinate] = useState<string | null>(
    preselected ? String(preselectedId) : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<GoalDefinitionFormValues>({
    initialValues: { title: "", description: "", type: "NUMBER", targetValue: "" },
    validate: goalDefinitionValidation(t),
  });

  // The picker is skipped entirely when the subordinate arrives prefilled (card/list flows).
  const { data: reports } = useQuery({
    queryKey: ["teamMembers", "goalPicker"],
    queryFn: () =>
      listTeamMembers({ view: "managed", page: 1, pageSize: PICKER_PAGE_SIZE, sort: "name" }),
    staleTime: 5 * 60 * 1000,
    enabled: !preselected,
  });
  const options = useMemo(() => {
    // The members list has one row per (user, team) — dedupe to one option per person.
    const byId = new Map<number, string>();
    for (const row of reports?.items ?? []) {
      if (!byId.has(row.userId)) byId.set(row.userId, row.name);
    }
    return [...byId.entries()].map(([value, label]) => ({ value: String(value), label }));
  }, [reports]);

  async function save(values: GoalDefinitionFormValues) {
    if (!subordinate) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await createGoal({
        subordinateId: Number(subordinate),
        ...toDefinitionBody(values),
      });
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      const editUrl = backParam
        ? `/goals/${created.id}/edit?from=managed&back=${encodeURIComponent(backParam)}`
        : `/goals/${created.id}/edit?from=managed`;
      navigate(editUrl, { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "goal.error.createForbidden",
          invalid: "goal.error.invalid",
          failedStatus: "goal.error.updateFailedStatus",
          failed: "goal.error.createFailed",
        }),
      );
      setSubmitting(false);
    }
  }

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(save)} noValidate>
          <Stack>
            <Stack gap={4}>
              <Title order={2}>{t("goal.createTitle")}</Title>
              <Text c="dimmed" size="sm">
                {t("goal.createHint")}
              </Text>
            </Stack>

            <Group gap="xl" align="flex-start">
              <PersonaField label={t("goal.manager")} you />
              {preselected ? (
                <PersonaField
                  label={t("goal.subordinate")}
                  name={subordinateName ?? `#${preselectedId}`}
                />
              ) : (
                <Select
                  label={t("goal.subordinate")}
                  placeholder={t("goal.pickSubordinate")}
                  data={options}
                  value={subordinate}
                  onChange={setSubordinate}
                  searchable
                  clearable
                  nothingFoundMessage={t("goal.noReports")}
                />
              )}
            </Group>

            <TextInput
              label={t("goal.title")}
              maxLength={MAX_GOAL_TITLE_LENGTH}
              withAsterisk
              {...form.getInputProps("title")}
            />
            <Stack gap={4}>
              <Suspense fallback={<Skeleton height={220} radius="sm" />}>
                <MarkdownEditor
                  label={t("goal.description")}
                  value={form.values.description}
                  onChange={(md) => form.setFieldValue("description", md)}
                  maxLength={MAX_GOAL_TEXT_LENGTH}
                />
              </Suspense>
              {form.errors.description && (
                <Text size="sm" c="red">
                  {form.errors.description}
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
                {...form.getInputProps("type")}
              />
              {form.values.type !== "BINARY" && (
                <NumberInput
                  label={t("goal.target")}
                  withAsterisk
                  w={200}
                  min={form.values.type === "PERCENTAGE" ? 0 : undefined}
                  max={form.values.type === "PERCENTAGE" ? 100 : undefined}
                  suffix={form.values.type === "PERCENTAGE" ? "%" : undefined}
                  {...form.getInputProps("targetValue")}
                />
              )}
            </Group>

            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}

            <Group justify="flex-end" gap="sm">
              <Button type="button" variant="default" onClick={openCancel} disabled={submitting}>
                {t("common.action.cancel")}
              </Button>
              <Button type="submit" loading={submitting} disabled={!subordinate}>
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
        title={t("goal.discardTitle")}
        message={t("goal.discardMessage")}
        cancelLabel={t("common.action.keepEditing")}
        confirmLabel={t("common.action.discard")}
        confirmTo={backTo}
      />
    </Container>
  );
}
