import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Group, Paper, Select, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { activateGoal, createGoal } from "../api/goals";
import CreateActivateModals from "../components/CreateActivateModals";
import GoalDefinitionFields from "../components/GoalDefinitionFields";
import PersonaField from "../components/PersonaField";
import { toReportOptions, useManagedReports } from "../hooks/useManagedReports";
import { useCreateThenActivate } from "../hooks/useCreateThenActivate";
import {
  goalDefinitionValidation,
  toDefinitionBody,
  type GoalDefinitionFormValues,
} from "../utils/goalForm";
import { invalidateGoal } from "../utils/goalQueries";

// Default cancel target when no `back` param is present: the subordinates grid, the only
// entry point that links here today.
const BACK_TO = "/?tab=subordinates";
/**
 * The manager's goal-create screen: pick (or arrive with) a direct report, define the goal —
 * the same definition fields the DRAFT editor offers — and Create. The lifecycle (DRAFT
 * lands, activate prompt, error handling) is the shared `useCreateThenActivate` flow.
 */
export default function CreateGoal() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  const preselectedId = Number(searchParams.get("subordinateId"));
  const preselected = Number.isFinite(preselectedId) && preselectedId > 0;
  const subordinateName = searchParams.get("subordinateName");
  const backParam = searchParams.get("back");
  const backTo = backParam ?? BACK_TO;

  const [subordinate, setSubordinate] = useState<string | null>(
    preselected ? String(preselectedId) : null,
  );
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);
  const flow = useCreateThenActivate({
    area: "goal",
    backTo,
    activate: activateGoal,
    invalidate: invalidateGoal,
  });

  const form = useForm<GoalDefinitionFormValues>({
    initialValues: { title: "", description: "", type: "NUMBER", targetValue: "", milestones: [], dueDate: "" },
    validate: goalDefinitionValidation(t),
  });

  // The picker is skipped entirely when the subordinate arrives prefilled (card/list flows).
  const { reports, reportsError } = useManagedReports(!preselected);
  const options = toReportOptions(reports);

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("GOALS")) return <Navigate to="/" replace />;

  async function save(values: GoalDefinitionFormValues) {
    if (!subordinate) return;
    await flow.submitCreate(() =>
      createGoal({
        subordinateId: Number(subordinate),
        ...toDefinitionBody(values),
      }),
    );
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
                  error={reportsError ? t("common.error.optionsFailed") : undefined}
                />
              )}
            </Group>

            <GoalDefinitionFields form={form} />

            {flow.error && (
              <Alert color="red" variant="light">
                {flow.error}
              </Alert>
            )}

            <Group justify="flex-end" gap="sm">
              <Button type="button" variant="default" onClick={openCancel} disabled={flow.submitting}>
                {t("common.action.cancel")}
              </Button>
              <Button
                type="submit"
                loading={flow.submitting}
                disabled={!subordinate || flow.createdId != null}
              >
                {t("common.action.create")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <CreateActivateModals
        area="goal"
        backTo={backTo}
        cancelOpen={cancelOpen}
        onCancelClose={closeCancel}
        createdId={flow.createdId}
        promptClosed={flow.promptClosed}
        activating={flow.activating}
        onFinishAsDraft={flow.finishAsDraft}
        onActivate={flow.activateNow}
      />
    </Container>
  );
}
