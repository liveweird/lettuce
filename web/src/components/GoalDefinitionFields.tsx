import { charCountDescription } from "../utils/charCount";
import { lazy, Suspense } from "react";
import { Group, NumberInput, Select, Skeleton, Stack, Text, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import { todayIsoDate } from "../utils/datetime";
import {
  MAX_GOAL_TEXT_LENGTH,
  MAX_GOAL_TITLE_LENGTH,
  type GoalDefinitionFormValues,
} from "../utils/goalForm";
import GoalMilestonesEditor from "./GoalMilestonesEditor";

// ~0.5 MB of MDXEditor — loaded only when a definition form actually renders.
const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

/**
 * The goal-definition field block (title, markdown description, type, type-specific target or
 * — for PLAN — the milestone list editor), shared by the create screen and the DRAFT editor.
 * The embedding form owns submission, footer buttons, and the surrounding layout;
 * `typeChangeWarning` is the DRAFT editor's "changing the type discards recorded progress"
 * notice.
 */
export default function GoalDefinitionFields({
  form,
  typeChangeWarning = false,
}: {
  form: UseFormReturnType<GoalDefinitionFormValues>;
  typeChangeWarning?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap="lg">
      <TextInput
        label={t("goal.title")}
        maxLength={MAX_GOAL_TITLE_LENGTH}
        description={charCountDescription(form.values.title.length, MAX_GOAL_TITLE_LENGTH)}
        inputWrapperOrder={["label", "input", "description", "error"]}
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
          data={(["PLAN", "NUMBER", "PERCENTAGE"] as const).map((type) => ({
            value: type,
            label: t(`goal.type.${type}`),
          }))}
          allowDeselect={false}
          w={200}
          {...form.getInputProps("type")}
        />
        {form.values.type !== "PLAN" && (
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
        <TextInput
          type="date"
          label={t("goal.dueDate")}
          withAsterisk
          w={180}
          min={todayIsoDate()}
          {...form.getInputProps("dueDate")}
        />
      </Group>
      {form.values.type === "PLAN" && <GoalMilestonesEditor form={form} />}
      {typeChangeWarning && (
        <Text size="sm" c="orange">
          {t("goal.typeChangeWarning")}
        </Text>
      )}
    </Stack>
  );
}
