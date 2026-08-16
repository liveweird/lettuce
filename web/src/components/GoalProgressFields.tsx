import { Checkbox, Group, Input, NumberInput, Stack, Text } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import type { GoalResponse } from "../api/goals";
import EmojiTextarea from "./EmojiTextarea";
import ReadOnlyField from "./ReadOnlyField";
import ProseBox from "./ProseBox";
import MarkdownView from "./MarkdownView";
import { MAX_GOAL_TEXT_LENGTH } from "../utils/goalForm";
import { formatGoalValue } from "../utils/goalValues";

interface GoalProgressMilestoneValue {
  id: number;
  description: string;
  done: boolean;
}

export interface GoalProgressFormValues {
  currentValue: number | string;
  // PLAN: the complete done-state, one entry per milestone (descriptions are display-only —
  // the definition owns them).
  milestones: GoalProgressMilestoneValue[];
  // The optional context of this update (v2.8.0) — lands in the goal's history, never stored
  // on the goal itself.
  comment: string;
}

/**
 * The Update screen's field block: the frozen definition (title, target) plus the live progress
 * state — one checkbox per milestone for PLAN (done rows struck through), the current-value
 * NumberInput otherwise — and the optional per-update comment. The embedding form owns
 * submission and the footer.
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
      {/* The definition is frozen while ACTIVE (deactivate to edit it) — only progress is live. */}
      <Input.Wrapper label={t("goal.title")}>
        <Text fw={500}>{goal.title}</Text>
      </Input.Wrapper>
      <Input.Wrapper label={t("goal.description")}>
        <ProseBox>
          <MarkdownView>{goal.description}</MarkdownView>
        </ProseBox>
      </Input.Wrapper>
      {goal.type === "PLAN" ? (
        <Input.Wrapper label={t("goal.milestones")}>
          <Stack gap="xs" mt={4}>
            {form.values.milestones.map((milestone, index) => (
              <Checkbox
                key={milestone.id}
                label={
                  <Text
                    span
                    size="sm"
                    c={milestone.done ? "dimmed" : undefined}
                    style={{
                      // Done milestones are visibly settled: struck through + dimmed.
                      textDecoration: milestone.done ? "line-through" : undefined,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {milestone.description}
                  </Text>
                }
                {...form.getInputProps(`milestones.${index}.done`, { type: "checkbox" })}
              />
            ))}
          </Stack>
        </Input.Wrapper>
      ) : (
        <Group gap="xl" align="flex-start">
          <ReadOnlyField label={t("goal.target")}>
            <Text size="sm">{formatGoalValue(goal.type, goal.targetValue, locale)}</Text>
          </ReadOnlyField>
          <NumberInput
            label={t("goal.current")}
            // Required only once a value exists (it can't be unset); a valueless goal
            // (v2.8.1) accepts a comment-only update with the field left empty.
            withAsterisk={goal.currentValue != null}
            w={200}
            min={goal.type === "PERCENTAGE" ? 0 : undefined}
            max={goal.type === "PERCENTAGE" ? 100 : undefined}
            suffix={goal.type === "PERCENTAGE" ? "%" : undefined}
            {...form.getInputProps("currentValue")}
          />
        </Group>
      )}
      <EmojiTextarea
        label={t("goal.progress.commentLabel")}
        placeholder={t("goal.progress.commentPlaceholder")}
        value={form.values.comment}
        onChange={(value) => form.setFieldValue("comment", value)}
        maxLength={MAX_GOAL_TEXT_LENGTH}
        autosize
        minRows={2}
      />
    </Stack>
  );
}
