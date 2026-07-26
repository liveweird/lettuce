import { Group, Input, NumberInput, Stack, Switch, Text } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import type { GoalResponse } from "../api/client";
import ReadOnlyField from "./ReadOnlyField";
import { formatGoalValue } from "../utils/goalValues";

export interface GoalProgressFormValues {
  currentValue: number | string;
  achieved: boolean;
}

/**
 * The ACTIVE editor's field block: the frozen definition (title, target) plus the one live
 * value — the achieved Switch for BINARY, the current-value NumberInput otherwise. The
 * embedding form owns submission and the footer.
 */
export default function GoalProgressFields({
  goal,
  form,
  locale,
}: {
  goal: GoalResponse;
  form: UseFormReturnType<GoalProgressFormValues>;
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap="lg">
      {/* The definition is frozen while ACTIVE (deactivate to edit it) — only the value is live. */}
      <Input.Wrapper label={t("goal.title")}>
        <Text fw={500}>{goal.title}</Text>
      </Input.Wrapper>
      {goal.type === "BINARY" ? (
        <Switch
          label={t("goal.achieved")}
          checked={form.values.achieved}
          onChange={(event) => form.setFieldValue("achieved", event.currentTarget.checked)}
        />
      ) : (
        <Group gap="xl" align="flex-start">
          <ReadOnlyField label={t("goal.target")}>
            <Text size="sm">{formatGoalValue(goal.type, goal.targetValue, locale)}</Text>
          </ReadOnlyField>
          <NumberInput
            label={t("goal.current")}
            withAsterisk
            w={200}
            min={goal.type === "PERCENTAGE" ? 0 : undefined}
            max={goal.type === "PERCENTAGE" ? 100 : undefined}
            suffix={goal.type === "PERCENTAGE" ? "%" : undefined}
            {...form.getInputProps("currentValue")}
          />
        </Group>
      )}
    </Stack>
  );
}
