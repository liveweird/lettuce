import { Badge, Center, Group, Loader, Modal, Text, Timeline } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getActionItemHistory } from "../api/client";
import { formatIsoDate } from "../utils/datetime";

/**
 * The cross-meeting history of an action item: one timeline entry per meeting the item (or a
 * carried-over copy of it) appeared in, newest meeting first (server-ordered). Opened from the
 * carried-over badge on the 1:1 edit/view screens; `itemId == null` keeps the modal closed.
 */
export default function ActionItemHistoryModal({
  itemId,
  onClose,
  managerName,
  subordinateName,
}: {
  itemId: number | null;
  onClose: () => void;
  managerName: string;
  subordinateName: string;
}) {
  const { t, i18n } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["actionItemHistory", itemId],
    queryFn: () => getActionItemHistory(itemId!),
    enabled: itemId != null,
    retry: false,
  });

  const ownerName = (owner: "MANAGER" | "SUBORDINATE") =>
    owner === "MANAGER" ? managerName : subordinateName;

  return (
    <Modal opened={itemId != null} onClose={onClose} title={t("oneOnOne.itemHistoryTitle")} centered>
      {isLoading ? (
        <Center py="md">
          <Loader size="sm" />
        </Center>
      ) : isError ? (
        <Text c="red" size="sm">
          {t("oneOnOne.itemHistoryError")}
        </Text>
      ) : !data || data.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t("oneOnOne.itemHistoryEmpty")}
        </Text>
      ) : (
        <Timeline bulletSize={12} lineWidth={2}>
          {data.map((entry) => (
            <Timeline.Item
              key={entry.actionItemId}
              title={formatIsoDate(entry.meetingDate, i18n.language)}
            >
              <Text size="sm">{entry.content}</Text>
              <Group gap="xs" mt={4}>
                <Badge variant="light" color={entry.resolved ? "green" : "yellow"}>
                  {entry.resolved ? t("oneOnOne.resolved") : t("oneOnOne.open")}
                </Badge>
                <Text size="xs" c="dimmed">
                  {t("oneOnOne.ownerLine", { name: ownerName(entry.owner) })}
                  {entry.dueDate
                    ? ` · ${t("oneOnOne.dueLine", { date: formatIsoDate(entry.dueDate, i18n.language) })}`
                    : ""}
                </Text>
              </Group>
            </Timeline.Item>
          ))}
        </Timeline>
      )}
    </Modal>
  );
}
