import { useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import EmojiTextarea from "./EmojiTextarea";
import type { UseFormReturnType } from "@mantine/form";
import { IconHistory, IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { ActionItemOwner } from "../api/client";
import { formatIsoDate } from "../utils/datetime";
import type { OneOnOneFormValues } from "../utils/oneOnOneForm";
import { MAX_ITEM_LENGTH, emptyActionItemDraft } from "../utils/oneOnOneForm";
import ActionItemHistoryModal from "./ActionItemHistoryModal";
import { RowControls } from "./ParagraphListEditor";

/**
 * The action-items editor of the 1:1 form: each row is a paragraph plus an owner (one of the
 * meeting's two parties), an optional due date, and a resolved checkbox. Rows carried over from
 * the previous meeting (copiedFromId set) get a badge and a history button opening the
 * cross-meeting timeline of that item.
 */
export default function ActionItemsEditor({
  form,
  managerName,
  subordinateName,
}: {
  form: UseFormReturnType<OneOnOneFormValues>;
  managerName: string;
  subordinateName: string;
}) {
  const { t, i18n } = useTranslation();
  const [historyItemId, setHistoryItemId] = useState<number | null>(null);
  const rows = form.values.actionItems;
  const title = t("oneOnOne.actionItems");
  const ownerOptions: { value: ActionItemOwner; label: string }[] = [
    { value: "MANAGER", label: managerName },
    { value: "SUBORDINATE", label: subordinateName },
  ];

  return (
    <Stack gap="xs">
      <Title order={4}>{title}</Title>
      {rows.length === 0 && (
        <Text c="dimmed" size="sm">
          {t("oneOnOne.noActionItems")}
        </Text>
      )}
      {rows.map((row, index) => (
        <Paper key={row.key} withBorder p="sm" radius="md">
          <Stack gap="xs">
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
                {...form.getInputProps(`actionItems.${index}.content`)}
              />
              <RowControls
                index={index}
                count={rows.length}
                onMoveUp={() => form.reorderListItem("actionItems", { from: index, to: index - 1 })}
                onMoveDown={() => form.reorderListItem("actionItems", { from: index, to: index + 1 })}
                onRemove={() => form.removeListItem("actionItems", index)}
                moveUpLabel={t("oneOnOne.moveUp", { list: title, position: index + 1 })}
                moveDownLabel={t("oneOnOne.moveDown", { list: title, position: index + 1 })}
                removeLabel={t("oneOnOne.removeItem", { list: title, position: index + 1 })}
              />
            </Group>
            <Group gap="md" align="flex-end" wrap="wrap">
              <Select
                label={t("oneOnOne.owner")}
                data={ownerOptions}
                allowDeselect={false}
                w={200}
                comboboxProps={{ withinPortal: false }}
                {...form.getInputProps(`actionItems.${index}.owner`)}
              />
              <TextInput
                type="date"
                label={t("oneOnOne.dueDate")}
                w={170}
                {...form.getInputProps(`actionItems.${index}.dueDate`)}
              />
              <Checkbox
                label={t("oneOnOne.resolved")}
                pb={8}
                {...form.getInputProps(`actionItems.${index}.resolved`, { type: "checkbox" })}
              />
              {row.copiedFromId != null && (
                <Group gap={4} pb={4}>
                  <Badge variant="light" color="grape" style={{ minWidth: "max-content" }}>
                    {/* The origin date shows how long the item has been postponed. */}
                    {row.firstAppearedOn != null
                      ? t("oneOnOne.carriedOverSince", {
                          date: formatIsoDate(row.firstAppearedOn, i18n.language),
                        })
                      : t("oneOnOne.carriedOver")}
                  </Badge>
                  <ActionIcon
                    variant="subtle"
                    color="grape"
                    onClick={() => setHistoryItemId(row.id ?? null)}
                    aria-label={t("oneOnOne.itemHistoryAria", { position: index + 1 })}
                  >
                    <IconHistory size={16} />
                  </ActionIcon>
                </Group>
              )}
            </Group>
          </Stack>
        </Paper>
      ))}
      <Group>
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => form.insertListItem("actionItems", emptyActionItemDraft())}
        >
          {t("oneOnOne.addActionItem")}
        </Button>
      </Group>
      <ActionItemHistoryModal
        itemId={historyItemId}
        onClose={() => setHistoryItemId(null)}
        managerName={managerName}
        subordinateName={subordinateName}
      />
    </Stack>
  );
}
