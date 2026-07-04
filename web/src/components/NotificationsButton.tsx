import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Indicator,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBell, IconCheck, IconChecks, IconEyeOff, IconExternalLink } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useNavigate } from "react-router-dom";
import {
  listNotifications,
  markAllNotificationsSeen,
  markNotificationSeen,
  markNotificationUnseen,
  type NotificationItem,
} from "../api/client";
import { formatTimestamp } from "../utils/datetime";
import { toRelativePath } from "../utils/url";

// The i18n key per notification type. The message is rendered in the viewer's language from
// notifications.event.* with the party names (proper nouns) interpolated from `params`.
const EVENT_KEY: Record<NotificationItem["type"], string> = {
  FEEDBACK_REQUESTED_TO_PROVIDER: "requestedToProvider",
  FEEDBACK_REQUESTED_TO_REQUESTER: "requestedToRequester",
  FEEDBACK_SENT_TO_SUBJECT: "sentToSubject",
  FEEDBACK_SENT_TO_PROVIDER: "sentToProvider",
  FEEDBACK_SENT_TO_REQUESTER: "sentToRequester",
  FEEDBACK_REJECTED_TO_REQUESTER: "rejectedToRequester",
  FEEDBACK_PICKED_UP_TO_REQUESTER: "pickedUpToRequester",
  FEEDBACK_WITHDRAWN_TO_SUBJECT: "withdrawnToSubject",
  FEEDBACK_WITHDRAWN_TO_REQUESTER: "withdrawnToRequester",
  FEEDBACK_DELETED_TO_REQUESTER: "deletedToRequester",
};

function describeNotification(n: NotificationItem, t: TFunction): string {
  const key = EVENT_KEY[n.type];
  if (!key) return n.type; // forward-compat: an unknown kind → show the raw type
  const params = n.params ?? {};
  // `self` drives the "about yourself" wording variant via i18next context.
  return t(`notifications.event.${key}`, { ...params, context: params.self });
}

// Poll the bell so notifications minted elsewhere (e.g. someone sending you feedback) show up
// without a manual refresh. `refetchIntervalInBackground` defaults to false, so polling pauses
// while the tab is hidden. Own-action freshness comes from invalidating ["notifications"] in the
// feedback flows.
const UNREAD_REFETCH_MS = 30_000;

export default function NotificationsButton() {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Cheap unread count: pageSize 1, read only `total`.
  const unreadQuery = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => listNotifications({ page: 1, pageSize: 1, wasSeen: false }),
    refetchInterval: UNREAD_REFETCH_MS,
  });
  const unreadCount = unreadQuery.data?.total ?? 0;

  const listQuery = useQuery({
    queryKey: ["notifications", "list"],
    queryFn: () => listNotifications({ page: 1, pageSize: 50, sort: "-timestamp" }),
    enabled: opened,
    refetchInterval: UNREAD_REFETCH_MS, // only polls while the modal is open (enabled)
  });

  const markSeen = useMutation({
    mutationFn: (id: number) => markNotificationSeen(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markUnseen = useMutation({
    mutationFn: (id: number) => markNotificationUnseen(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllSeen = useMutation({
    mutationFn: () => markAllNotificationsSeen(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  function goTo(n: NotificationItem) {
    if (!n.link) return;
    close();
    navigate(toRelativePath(n.link));
  }

  return (
    <>
      <Indicator
        inline
        size={18}
        offset={4}
        color="red"
        label={unreadCount > 99 ? "99+" : unreadCount}
        disabled={unreadCount === 0}
      >
        <ActionIcon
          variant="default"
          size="lg"
          onClick={open}
          aria-label={`${t("notifications.title")} (${t("notifications.unread", { count: unreadCount })})`}
        >
          <IconBell size={18} />
        </ActionIcon>
      </Indicator>

      {/* Composition API instead of the `title` prop so "Mark all as seen" can live in the
          header row itself (title left, bulk action + close right) rather than as a detached
          strip above the list. */}
      <Modal.Root opened={opened} onClose={close} centered size="lg">
        <Modal.Overlay />
        <Modal.Content>
          <Modal.Header>
            <Modal.Title>{t("notifications.title")}</Modal.Title>
            <Group gap="sm">
              {unreadCount > 0 && (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconChecks size={14} />}
                  onClick={() => markAllSeen.mutate()}
                  loading={markAllSeen.isPending}
                >
                  {t("notifications.markAllSeen")}
                </Button>
              )}
              <Modal.CloseButton />
            </Group>
          </Modal.Header>
          <Modal.Body>
            {listQuery.isLoading ? (
              <Center py="xl">
                <Loader />
              </Center>
            ) : listQuery.isError ? (
              <Alert color="red" title={t("notifications.loadError")}>
                {listQuery.error instanceof Error ? listQuery.error.message : t("notifications.unknownError")}
              </Alert>
            ) : (listQuery.data?.items.length ?? 0) === 0 ? (
              <Text c="dimmed" ta="center" py="xl">
                {t("notifications.empty")}
              </Text>
            ) : (
              <ScrollArea.Autosize mah="60vh">
                <Stack gap="sm">
                  {listQuery.data!.items.map((n) => (
                    <Paper key={n.id} withBorder p="sm" radius="md" bg={n.wasSeen ? undefined : "var(--mantine-color-blue-light)"}>
                      <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                          <Group gap="xs" wrap="nowrap">
                            {!n.wasSeen && (
                              <Badge color="blue" size="sm" variant="filled">
                                {t("notifications.new")}
                              </Badge>
                            )}
                            <Text size="xs" c="dimmed">
                              {formatTimestamp(n.timestamp)}
                            </Text>
                          </Group>
                          <Text size="sm" fw={n.wasSeen ? 400 : 600} c={n.wasSeen ? "dimmed" : undefined}>
                            {describeNotification(n, t)}
                          </Text>
                        </Stack>
                        <Group gap="xs" wrap="nowrap">
                          {!n.wasSeen && (
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconCheck size={14} />}
                              onClick={() => markSeen.mutate(n.id)}
                              loading={markSeen.isPending && markSeen.variables === n.id}
                              aria-label={t("notifications.markSeenAria", { id: n.id })}
                            >
                              {t("notifications.markSeen")}
                            </Button>
                          )}
                          {n.wasSeen && (
                            <Button
                              size="xs"
                              variant="default"
                              leftSection={<IconEyeOff size={14} />}
                              onClick={() => markUnseen.mutate(n.id)}
                              loading={markUnseen.isPending && markUnseen.variables === n.id}
                              aria-label={t("notifications.markUnseenAria", { id: n.id })}
                            >
                              {t("notifications.markUnseen")}
                            </Button>
                          )}
                          {n.link && (
                            <Button
                              size="xs"
                              variant="subtle"
                              leftSection={<IconExternalLink size={14} />}
                              onClick={() => goTo(n)}
                              aria-label={t("notifications.goToAria", { id: n.id })}
                            >
                              {t("notifications.goTo")}
                            </Button>
                          )}
                        </Group>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            )}
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </>
  );
}
