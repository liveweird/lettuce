import { Button, Group, Input, Paper, Stack, Text } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { GoalDefinitionFormValues } from "../utils/goalForm";
import { MAX_GOAL_MILESTONES, MAX_GOAL_TEXT_LENGTH, emptyMilestoneDraft } from "../utils/goalForm";
import EmojiTextarea from "./EmojiTextarea";
import { RowControls } from "./ParagraphListEditor";

/**
 * The PLAN goal's milestone editor (the ActionItemsEditor shape): ordered rows of one textual
 * description each, reorderable and removable, plus an "Add milestone" button. Done flags are
 * shown struck-through but are NOT editable here — ticking is the ACTIVE Update screen's job
 * (the server preserves flags across definition saves by id).
 */
export default function GoalMilestonesEditor({
  form,
}: {
  form: UseFormReturnType<GoalDefinitionFormValues>;
}) {
  const { t } = useTranslation();
  const rows = form.values.milestones;
  const list = t("goal.milestones");

  return (
    <Input.Wrapper label={list}>
      <Stack gap="xs" mt={4}>
        {rows.length === 0 && (
          <Text c="dimmed" size="sm">
            {t("goal.noMilestones")}
          </Text>
        )}
        {rows.map((row, index) => (
          <Paper key={row.key} withBorder p="sm" radius="md">
            <Group align="flex-start" gap="xs" wrap="nowrap">
              <Text
                size="sm"
                c="dimmed"
                w={24}
                ta="right"
                pt={8}
                style={{
                  flexShrink: 0,
                  textDecoration: row.done ? "line-through" : undefined,
                }}
              >
                {index + 1}.
              </Text>
              <EmojiTextarea
                style={{ flex: 1 }}
                autosize
                minRows={1}
                maxRows={8}
                maxLength={MAX_GOAL_TEXT_LENGTH}
                counter="nearLimit"
                aria-label={t("goal.milestoneAria", { position: index + 1 })}
                {...form.getInputProps(`milestones.${index}.description`)}
              />
              <RowControls
                index={index}
                count={rows.length}
                onMoveUp={() => form.reorderListItem("milestones", { from: index, to: index - 1 })}
                onMoveDown={() => form.reorderListItem("milestones", { from: index, to: index + 1 })}
                onRemove={() => form.removeListItem("milestones", index)}
                moveUpLabel={t("goal.milestoneMoveUp", { position: index + 1 })}
                moveDownLabel={t("goal.milestoneMoveDown", { position: index + 1 })}
                removeLabel={t("goal.milestoneRemove", { position: index + 1 })}
              />
            </Group>
            {row.done && (
              <Text size="xs" c="dimmed" mt={4} ml={32}>
                {t("goal.milestoneDoneNote")}
              </Text>
            )}
          </Paper>
        ))}
        <Group>
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlus size={14} />}
            disabled={rows.length >= MAX_GOAL_MILESTONES}
            onClick={() => form.insertListItem("milestones", emptyMilestoneDraft())}
          >
            {t("goal.addMilestone")}
          </Button>
        </Group>
      </Stack>
    </Input.Wrapper>
  );
}
