import type { ReactNode } from "react";
import { ActionIcon, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import EmojiTextarea from "./EmojiTextarea";
import type { UseFormReturnType } from "@mantine/form";
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { OneOnOneFormValues } from "../utils/oneOnOneForm";
import { MAX_ITEM_LENGTH, emptyItemDraft } from "../utils/oneOnOneForm";

/**
 * The ordered-paragraph-list editor shared by the 1:1 form's "points discussed" and
 * "decisions made" sections: a Textarea per row with up/down reorder, remove, and an Add
 * button. Reordering swaps adjacent rows via Mantine's reorderListItem, so row ids (and
 * therefore server-side item identity) travel with their content.
 */
export default function ParagraphListEditor({
  form,
  listField,
  title,
  addLabel,
  emptyLabel,
}: {
  form: UseFormReturnType<OneOnOneFormValues>;
  listField: "points" | "decisions";
  title: string;
  addLabel: string;
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  const rows = form.values[listField];

  return (
    <Stack gap="xs">
      <Title order={4}>{title}</Title>
      {rows.length === 0 && (
        <Text c="dimmed" size="sm">
          {emptyLabel}
        </Text>
      )}
      {rows.map((row, index) => (
        <Paper key={row.key} withBorder p="sm" radius="md">
          <Group align="flex-start" gap="xs" wrap="nowrap">
            <Text size="sm" c="dimmed" w={24} ta="right" pt={8} style={{ flexShrink: 0 }}>
              {index + 1}.
            </Text>
            <EmojiTextarea
              style={{ flex: 1 }}
              autosize
              minRows={1}
              maxRows={8}
              maxLength={MAX_ITEM_LENGTH}
              counter="nearLimit"
              aria-label={t("oneOnOne.itemAria", { list: title, position: index + 1 })}
              {...form.getInputProps(`${listField}.${index}.content`)}
            />
            <RowControls
              index={index}
              count={rows.length}
              onMoveUp={() => form.reorderListItem(listField, { from: index, to: index - 1 })}
              onMoveDown={() => form.reorderListItem(listField, { from: index, to: index + 1 })}
              onRemove={() => form.removeListItem(listField, index)}
              moveUpLabel={t("oneOnOne.moveUp", { list: title, position: index + 1 })}
              moveDownLabel={t("oneOnOne.moveDown", { list: title, position: index + 1 })}
              removeLabel={t("oneOnOne.removeItem", { list: title, position: index + 1 })}
            />
          </Group>
        </Paper>
      ))}
      <Group>
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => form.insertListItem(listField, emptyItemDraft())}
        >
          {addLabel}
        </Button>
      </Group>
    </Stack>
  );
}

/** The up/down/remove control column shared with ActionItemsEditor. */
export function RowControls({
  index,
  count,
  onMoveUp,
  onMoveDown,
  onRemove,
  moveUpLabel,
  moveDownLabel,
  removeLabel,
  extra,
}: {
  index: number;
  count: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  moveUpLabel: string;
  moveDownLabel: string;
  removeLabel: string;
  extra?: ReactNode;
}) {
  return (
    <Group gap={4} wrap="nowrap">
      {extra}
      <ActionIcon
        variant="subtle"
        color="gray"
        disabled={index === 0}
        onClick={onMoveUp}
        aria-label={moveUpLabel}
      >
        <IconArrowUp size={16} />
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        color="gray"
        disabled={index === count - 1}
        onClick={onMoveDown}
        aria-label={moveDownLabel}
      >
        <IconArrowDown size={16} />
      </ActionIcon>
      <ActionIcon variant="subtle" color="red" onClick={onRemove} aria-label={removeLabel}>
        <IconTrash size={16} />
      </ActionIcon>
    </Group>
  );
}
