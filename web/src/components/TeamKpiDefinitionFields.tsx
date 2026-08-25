import { charCountDescription } from "../utils/charCount";
import { lazy, Suspense } from "react";
import { Group, NumberInput, Select, Skeleton, Stack, Text, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import {
  MAX_TEAM_KPI_TEXT_LENGTH,
  MAX_TEAM_KPI_TITLE_LENGTH,
  type TeamKpiDefinitionFormValues,
} from "../utils/teamKpiForm";

// ~0.5 MB of MDXEditor — loaded only when a definition form actually renders.
const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

/**
 * The team-KPI definition field block (title, markdown description, type, target), shared by
 * the create screen and the DRAFT editor — the GoalDefinitionFields shape minus the due date,
 * with the type Select limited to NUMBER/PERCENTAGE (no PLAN flavor, so the target input is
 * always present). The embedding form owns submission, footer buttons, and the surrounding
 * layout; `typeChangeWarning` is the DRAFT editor's "changing the type removes all collected
 * data points" notice.
 */
export default function TeamKpiDefinitionFields({
  form,
  typeChangeWarning = false,
}: {
  form: UseFormReturnType<TeamKpiDefinitionFormValues>;
  typeChangeWarning?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap="lg">
      <TextInput
        label={t("teamKpi.title")}
        maxLength={MAX_TEAM_KPI_TITLE_LENGTH}
        description={charCountDescription(form.values.title.length, MAX_TEAM_KPI_TITLE_LENGTH)}
        inputWrapperOrder={["label", "input", "description", "error"]}
        withAsterisk
        {...form.getInputProps("title")}
      />
      <Stack gap={4}>
        <Suspense fallback={<Skeleton height={220} radius="sm" />}>
          <MarkdownEditor
            label={t("teamKpi.description")}
            value={form.values.description}
            onChange={(md) => form.setFieldValue("description", md)}
            maxLength={MAX_TEAM_KPI_TEXT_LENGTH}
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
          label={t("teamKpi.type.label")}
          data={(["NUMBER", "PERCENTAGE"] as const).map((type) => ({
            value: type,
            label: t(`teamKpi.type.${type}`),
          }))}
          allowDeselect={false}
          w={200}
          {...form.getInputProps("type")}
        />
        <NumberInput
          label={t("teamKpi.target")}
          withAsterisk
          w={200}
          min={form.values.type === "PERCENTAGE" ? 0 : undefined}
          max={form.values.type === "PERCENTAGE" ? 100 : undefined}
          suffix={form.values.type === "PERCENTAGE" ? "%" : undefined}
          {...form.getInputProps("targetValue")}
        />
        <Select
          label={t("teamKpi.targetDirection.label")}
          data={(["AT_LEAST", "AT_MOST"] as const).map((direction) => ({
            value: direction,
            label: t(`teamKpi.targetDirection.${direction}`),
          }))}
          allowDeselect={false}
          w={200}
          {...form.getInputProps("targetDirection")}
        />
      </Group>
      {typeChangeWarning && (
        <Text size="sm" c="orange">
          {t("teamKpi.typeChangeWarning")}
        </Text>
      )}
    </Stack>
  );
}
