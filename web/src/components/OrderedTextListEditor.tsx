import { Button, Group, Input, Paper, Stack, Text } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  MAX_SUCCESSION_ITEM_LENGTH,
  MAX_SUCCESSION_LIST_ITEMS,
  type TextRowDraft,
} from "../utils/successionForm";
import EmojiTextarea from "./EmojiTextarea";
import { RowControls } from "./ParagraphListEditor";

/**
 * An ordered list of short texts the user can add/remove/reorder — the GoalMilestonesEditor
 * shape generalized over the form type (only `RowControls` was generic before): numbered
 * `Paper` rows of one bounded text each, payload order = list order. Used by the succession
 * plan's loss-impact list and the nomination's competency-gaps list.
 */
export default function OrderedTextListEditor<
  Field extends string,
  Values extends Record<Field, TextRowDraft[]>,
>({
  form,
  field,
  label,
  emptyLabel,
  addLabel,
  onAdd,
  rowAria,
}: {
  form: UseFormReturnType<Values>;
  /** The form field holding the `TextRowDraft[]` list. */
  field: Field;
  label: string;
  emptyLabel: string;
  addLabel: string;
  /** Appends one empty draft row — concrete at the call site (typed insertListItem). */
  onAdd: () => void;
  /** Per-row aria labels, 1-based: the input, move up, move down, remove. */
  rowAria: {
    item: (position: number) => string;
    moveUp: (position: number) => string;
    moveDown: (position: number) => string;
    remove: (position: number) => string;
  };
}) {
  const { t } = useTranslation();
  const rows: TextRowDraft[] = form.values[field];

  return (
    <Input.Wrapper label={label}>
      <Stack gap="xs" mt={4}>
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
                maxRows={4}
                maxLength={MAX_SUCCESSION_ITEM_LENGTH}
                counter="nearLimit"
                aria-label={rowAria.item(index + 1)}
                {...form.getInputProps(`${field}.${index}.value`)}
              />
              <RowControls
                index={index}
                count={rows.length}
                onMoveUp={() => form.reorderListItem(field, { from: index, to: index - 1 })}
                onMoveDown={() => form.reorderListItem(field, { from: index, to: index + 1 })}
                onRemove={() => form.removeListItem(field, index)}
                moveUpLabel={rowAria.moveUp(index + 1)}
                moveDownLabel={rowAria.moveDown(index + 1)}
                removeLabel={rowAria.remove(index + 1)}
              />
            </Group>
          </Paper>
        ))}
        <Group>
          <Button
            variant="light"
            size="xs"
            leftSection={<IconPlus size={14} />}
            disabled={rows.length >= MAX_SUCCESSION_LIST_ITEMS}
            onClick={onAdd}
          >
            {addLabel}
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          {t("succession.listLimitHint", { max: MAX_SUCCESSION_LIST_ITEMS })}
        </Text>
      </Stack>
    </Input.Wrapper>
  );
}
