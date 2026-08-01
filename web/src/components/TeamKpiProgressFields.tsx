import { Group, Input, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import type { TeamKpiResponse } from "../api/client";
import ReadOnlyField from "./ReadOnlyField";
import ProseBox from "./ProseBox";
import MarkdownView from "./MarkdownView";
import { formatGoalValue } from "../utils/goalValues";
import { todayIsoDate } from "../utils/datetime";

export interface TeamKpiProgressFormValues {
  currentValue: number | string;
  date: string;
}

/**
 * The ACTIVE editor's field block: the frozen definition (title, description, target) plus the
 * live pair — the current-value NumberInput (there is no BINARY flavor) and the date the value
 * was measured (today or earlier — the mirror of the goal due-date input, which bounds with
 * `min`). The embedding form owns submission and the footer.
 */
export default function TeamKpiProgressFields({
  kpi,
  form,
  locale,
}: {
  kpi: TeamKpiResponse;
  form: UseFormReturnType<TeamKpiProgressFormValues>;
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap="lg">
      {/* The definition is frozen while ACTIVE (deactivate to edit it) — only the value is live. */}
      <Input.Wrapper label={t("teamKpi.title")}>
        <Text fw={500}>{kpi.title}</Text>
      </Input.Wrapper>
      <Input.Wrapper label={t("teamKpi.description")}>
        <ProseBox>
          <MarkdownView>{kpi.description}</MarkdownView>
        </ProseBox>
      </Input.Wrapper>
      <Group gap="xl" align="flex-start">
        <ReadOnlyField label={t("teamKpi.target")}>
          <Text size="sm">{formatGoalValue(kpi.type, kpi.targetValue, locale)}</Text>
        </ReadOnlyField>
        <NumberInput
          label={t("teamKpi.current")}
          withAsterisk
          w={200}
          min={kpi.type === "PERCENTAGE" ? 0 : undefined}
          max={kpi.type === "PERCENTAGE" ? 100 : undefined}
          suffix={kpi.type === "PERCENTAGE" ? "%" : undefined}
          {...form.getInputProps("currentValue")}
        />
        <TextInput
          type="date"
          label={t("teamKpi.valueDate")}
          withAsterisk
          w={180}
          max={todayIsoDate()}
          {...form.getInputProps("date")}
        />
      </Group>
    </Stack>
  );
}
