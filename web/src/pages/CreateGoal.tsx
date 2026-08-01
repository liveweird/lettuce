import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Group, Paper, Select, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { activateGoal, createGoal, listTeamMembers } from "../api/client";
import ConfirmActionModal from "../components/ConfirmActionModal";
import GoalDefinitionFields from "../components/GoalDefinitionFields";
import PersonaField from "../components/PersonaField";
import {
  goalDefinitionValidation,
  toDefinitionBody,
  type GoalDefinitionFormValues,
} from "../utils/goalForm";
import { invalidateGoal } from "../utils/goalQueries";
import { saveErrorMessage } from "../utils/saveError";
import { groupTeamRows } from "../utils/teamRows";

// Default cancel target when no `back` param is present: the subordinates grid, the only
// entry point that links here today.
const BACK_TO = "/?tab=subordinates";
const PICKER_PAGE_SIZE = 100;

/**
 * The manager's goal-create screen: pick (or arrive with) a direct report, define the goal —
 * the same definition fields the DRAFT editor offers — and Create. The goal always lands as
 * DRAFT; on success a prompt asks whether to activate it immediately (Yes runs the
 * DRAFT→ACTIVE transition), and either answer returns to the originating screen (`backTo`).
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
  // Set once the goal exists — opens the activate prompt and retires the Create button
  // (the goal is already created; resubmitting would only 409 on the no-duplicate check).
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [activating, setActivating] = useState(false);
  // Closes the prompt without navigating — only the activate-failure path uses it.
  const [promptClosed, setPromptClosed] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<GoalDefinitionFormValues>({
    initialValues: { title: "", description: "", type: "NUMBER", targetValue: "", dueDate: "" },
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
  const options = useMemo(
    // The members list has one row per (user, team) — groupTeamRows dedupes to one per person.
    () =>
      groupTeamRows(reports?.items ?? []).map((p) => ({ value: String(p.userId), label: p.name })),
    [reports],
  );

  async function save(values: GoalDefinitionFormValues) {
    if (!subordinate) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await createGoal({
        subordinateId: Number(subordinate),
        ...toDefinitionBody(values),
      });
      await invalidateGoal(queryClient);
      // The goal exists as a DRAFT — ask whether to activate it right away; either answer
      // then returns to the originating screen.
      setSubmitting(false);
      setCreatedId(created.id);
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

  // "No" (or dismissing the prompt): keep the draft, return to where the user came from.
  function finishAsDraft() {
    navigate(backTo, { replace: true });
  }

  async function activateNow() {
    if (createdId == null) return;
    setActivating(true);
    try {
      await activateGoal(createdId);
      await invalidateGoal(queryClient, createdId);
      navigate(backTo, { replace: true });
    } catch (err) {
      // The goal stays a DRAFT — close the prompt and surface the error on the form
      // (Create is retired; the goal is reachable from the origin list).
      setPromptClosed(true);
      setActivating(false);
      setError(
        saveErrorMessage(err, t, {
          conflict: "goal.error.conflict",
          failed: "goal.error.activateAfterCreateFailed",
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

            <GoalDefinitionFields form={form} />

            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}

            <Group justify="flex-end" gap="sm">
              <Button type="button" variant="default" onClick={openCancel} disabled={submitting}>
                {t("common.action.cancel")}
              </Button>
              <Button
                type="submit"
                loading={submitting}
                disabled={!subordinate || createdId != null}
              >
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

      {/* Post-create prompt: Yes activates the fresh draft, No (or dismiss) keeps it —
          either way the user returns to the screen they came from. */}
      <ConfirmActionModal
        opened={createdId != null && !promptClosed}
        onClose={finishAsDraft}
        title={t("goal.activatePromptTitle")}
        message={t("goal.activatePromptQuestion")}
        cancelLabel={t("common.state.no")}
        confirmLabel={t("common.state.yes")}
        confirmColor="green"
        onConfirm={activateNow}
        loading={activating}
      />
    </Container>
  );
}
