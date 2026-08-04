import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Center,
  Group,
  Indicator,
  Loader,
  Modal,
  Pagination,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconArrowBackUp,
  IconBell,
  IconCalendarEvent,
  IconChartLine,
  IconCheck,
  IconChecks,
  IconClipboardText,
  IconExternalLink,
  IconEyeOff,
  IconKey,
  IconMessageQuestion,
  IconPencil,
  IconSend,
  IconTargetArrow,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useNavigate } from "react-router-dom";
import {
  deleteNotification,
  listNotifications,
  markAllNotificationsSeen,
  markNotificationSeen,
  markNotificationUnseen,
  type NotificationItem,
} from "../api/client";
import { formatIsoDate, formatIsoMonth, formatTimestamp } from "../utils/datetime";
import { formatGoalValue } from "../utils/goalValues";
import { toRelativePath } from "../utils/url";

// The i18n key per notification type. The message is rendered in the viewer's language from
// notifications.event.* with the party names (proper nouns) interpolated from `params`.
const EVENT_KEY: Record<NotificationItem["type"], string> = {
  FEEDBACK_REQUESTED_TO_PROVIDER: "requestedToProvider",
  FEEDBACK_REQUESTED_TO_REQUESTER: "requestedToRequester",
  FEEDBACK_SENT_TO_SUBJECT: "sentToSubject",
  FEEDBACK_SENT_TO_PROVIDER: "sentToProvider",
  FEEDBACK_SENT_TO_REQUESTER: "sentToRequester",
  FEEDBACK_SENT_TO_MANAGER: "sentToManager",
  FEEDBACK_REJECTED_TO_REQUESTER: "rejectedToRequester",
  FEEDBACK_PICKED_UP_TO_REQUESTER: "pickedUpToRequester",
  FEEDBACK_WITHDRAWN_TO_SUBJECT: "withdrawnToSubject",
  FEEDBACK_WITHDRAWN_TO_REQUESTER: "withdrawnToRequester",
  FEEDBACK_DELETED_TO_REQUESTER: "deletedToRequester",
  ONE_ON_ONE_CREATED_TO_SUBORDINATE: "oneOnOneCreated",
  ONE_ON_ONE_CREATED_TO_MANAGER: "oneOnOneCreatedToManager",
  GOAL_ACTIVATED_TO_SUBORDINATE: "goalActivated",
  GOAL_DEACTIVATED_TO_SUBORDINATE: "goalDeactivated",
  GOAL_ARCHIVED_TO_SUBORDINATE: "goalArchived",
  GOAL_REOPENED_TO_SUBORDINATE: "goalReopened",
  TEAM_KPI_ACTIVATED_TO_MEMBER: "teamKpiActivated",
  TEAM_KPI_DEACTIVATED_TO_MEMBER: "teamKpiDeactivated",
  TEAM_KPI_ARCHIVED_TO_MEMBER: "teamKpiArchived",
  TEAM_KPI_REOPENED_TO_MEMBER: "teamKpiReopened",
  TEAM_KPI_VALUE_RECORDED_TO_MEMBER: "teamKpiValueRecorded",
  TEAM_KPI_VALUE_CORRECTED_TO_MEMBER: "teamKpiValueCorrected",
  TEAM_KPI_VALUE_REMOVED_TO_MEMBER: "teamKpiValueRemoved",
  PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE: "performanceReviewPublished",
  PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE: "performanceReviewUnpublished",
  PASSWORD_CHANGED: "passwordChanged",
};

// The team-KPI data-point kinds carry raw ISO dates + Double values (plus the KPI's type) — the
// only params that need client-side formatting before interpolation.
const KPI_VALUE_KEYS = new Set(["teamKpiValueRecorded", "teamKpiValueCorrected", "teamKpiValueRemoved"]);

// The performance-review kinds carry the period's raw ISO YYYY-MM bounds — format per locale.
const REVIEW_PERIOD_KEYS = new Set(["performanceReviewPublished", "performanceReviewUnpublished"]);

function describeNotification(n: NotificationItem, t: TFunction, locale: string): string {
  const key = EVENT_KEY[n.type];
  if (!key) return n.type; // forward-compat: an unknown kind → show the raw type
  const params: Record<string, string | undefined> = { ...(n.params ?? {}) };
  if (KPI_VALUE_KEYS.has(key)) {
    // Format the values per the KPI's type (the "%" suffix for PERCENTAGE) and the dates per
    // the viewer's locale; anything unparseable passes through raw.
    const kpiType = params.kpiType === "PERCENTAGE" ? "PERCENTAGE" : "NUMBER";
    for (const k of ["value", "fromValue", "toValue"]) {
      const parsed = Number(params[k]);
      if (params[k] != null && Number.isFinite(parsed)) {
        params[k] = formatGoalValue(kpiType, parsed, locale);
      }
    }
    for (const k of ["date", "fromDate", "toDate"]) {
      if (params[k] != null) params[k] = formatIsoDate(params[k]!, locale);
    }
  }
  if (REVIEW_PERIOD_KEYS.has(key)) {
    for (const k of ["startMonth", "endMonth"]) {
      if (params[k] != null) params[k] = formatIsoMonth(params[k]!, locale);
    }
  }
  // `self` drives the "about yourself" wording variant via i18next context.
  return t(`notifications.event.${key}`, { ...params, context: params.self });
}

// Per-type row icon + accent color, for scannability. Same forward-compat stance as
// EVENT_KEY: an unknown kind falls back to the plain bell.
const TYPE_META: Record<NotificationItem["type"], { icon: typeof IconBell; color: string }> = {
  FEEDBACK_REQUESTED_TO_PROVIDER: { icon: IconMessageQuestion, color: "blue" },
  FEEDBACK_REQUESTED_TO_REQUESTER: { icon: IconMessageQuestion, color: "blue" },
  FEEDBACK_SENT_TO_SUBJECT: { icon: IconSend, color: "green" },
  FEEDBACK_SENT_TO_PROVIDER: { icon: IconSend, color: "green" },
  FEEDBACK_SENT_TO_REQUESTER: { icon: IconSend, color: "green" },
  FEEDBACK_SENT_TO_MANAGER: { icon: IconSend, color: "green" },
  FEEDBACK_REJECTED_TO_REQUESTER: { icon: IconX, color: "red" },
  FEEDBACK_PICKED_UP_TO_REQUESTER: { icon: IconPencil, color: "cyan" },
  FEEDBACK_WITHDRAWN_TO_SUBJECT: { icon: IconArrowBackUp, color: "orange" },
  FEEDBACK_WITHDRAWN_TO_REQUESTER: { icon: IconArrowBackUp, color: "orange" },
  FEEDBACK_DELETED_TO_REQUESTER: { icon: IconTrash, color: "gray" },
  ONE_ON_ONE_CREATED_TO_SUBORDINATE: { icon: IconCalendarEvent, color: "grape" },
  ONE_ON_ONE_CREATED_TO_MANAGER: { icon: IconCalendarEvent, color: "grape" },
  GOAL_ACTIVATED_TO_SUBORDINATE: { icon: IconTargetArrow, color: "green" },
  GOAL_DEACTIVATED_TO_SUBORDINATE: { icon: IconTargetArrow, color: "orange" },
  GOAL_ARCHIVED_TO_SUBORDINATE: { icon: IconTargetArrow, color: "blue" },
  GOAL_REOPENED_TO_SUBORDINATE: { icon: IconTargetArrow, color: "cyan" },
  TEAM_KPI_ACTIVATED_TO_MEMBER: { icon: IconChartLine, color: "green" },
  TEAM_KPI_DEACTIVATED_TO_MEMBER: { icon: IconChartLine, color: "orange" },
  TEAM_KPI_ARCHIVED_TO_MEMBER: { icon: IconChartLine, color: "blue" },
  TEAM_KPI_REOPENED_TO_MEMBER: { icon: IconChartLine, color: "cyan" },
  TEAM_KPI_VALUE_RECORDED_TO_MEMBER: { icon: IconChartLine, color: "teal" },
  TEAM_KPI_VALUE_CORRECTED_TO_MEMBER: { icon: IconChartLine, color: "indigo" },
  TEAM_KPI_VALUE_REMOVED_TO_MEMBER: { icon: IconChartLine, color: "gray" },
  PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE: { icon: IconClipboardText, color: "green" },
  PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE: { icon: IconClipboardText, color: "orange" },
  PASSWORD_CHANGED: { icon: IconKey, color: "orange" },
};

// Poll the bell so notifications minted elsewhere (e.g. someone sending you feedback) show up
// without a manual refresh. `refetchIntervalInBackground` defaults to false, so polling pauses
// while the tab is hidden. Own-action freshness comes from invalidating ["notifications"] in the
// feedback flows.
const UNREAD_REFETCH_MS = 30_000;

const PAGE_SIZE = 50;

export default function NotificationsButton() {
  const { t, i18n } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  function openModal() {
    setPage(1); // always reopen on the newest page
    open();
  }

  // Cheap unread count: pageSize 1, read only `total`.
  const unreadQuery = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => listNotifications({ page: 1, pageSize: 1, wasSeen: false }),
    refetchInterval: UNREAD_REFETCH_MS,
  });
  const unreadCount = unreadQuery.data?.total ?? 0;

  const listQuery = useQuery({
    queryKey: ["notifications", "list", page],
    queryFn: () => listNotifications({ page, pageSize: PAGE_SIZE, sort: "-timestamp" }),
    enabled: opened,
    refetchInterval: UNREAD_REFETCH_MS, // only polls while the modal is open (enabled)
    placeholderData: keepPreviousData, // no empty flash while stepping between pages
  });
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Deleting the last row of the last page (or the 30s poll observing someone else's
  // deletion) leaves an empty page — step back. Adjusted during render, the React-documented
  // replacement for the set-state-in-effect shape: React restarts the render immediately
  // instead of committing a wasted empty frame.
  if (listQuery.data && listQuery.data.items.length === 0 && page > 1) {
    setPage(page - 1);
  }

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

  const remove = useMutation({
    mutationFn: (id: number) => deleteNotification(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  function goTo(n: NotificationItem) {
    if (!n.link) return;
    // Following the link means the user has acted on the notification — mark it seen.
    // Fire-and-forget: navigation must not block on it, and a failure just leaves it unseen.
    if (!n.wasSeen) markSeen.mutate(n.id);
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
          variant="subtle"
          color="gray"
          size="lg"
          onClick={openModal}
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
              <Alert color="red" variant="light" title={t("notifications.loadError")}>
                {listQuery.error instanceof Error ? listQuery.error.message : t("notifications.unknownError")}
              </Alert>
            ) : (listQuery.data?.items.length ?? 0) === 0 ? (
              <Text c="dimmed" ta="center" py="xl">
                {t("notifications.empty")}
              </Text>
            ) : (
              <ScrollArea.Autosize mah="60vh" offsetScrollbars>
                {/* Semantic list (rows are <li>) — also the stable hook the e2e helpers use. */}
                <Box component="ul" m={0} p={0} style={{ listStyle: "none" }}>
                  {listQuery.data!.items.map((n, i) => {
                    const meta = TYPE_META[n.type] ?? { icon: IconBell, color: "gray" };
                    const TypeIcon = meta.icon;
                    return (
                      <Box
                        key={n.id}
                        component="li"
                        py="sm"
                        px={4}
                        style={{
                          borderTop:
                            i > 0 ? "1px solid var(--mantine-color-default-border)" : undefined,
                        }}
                      >
                        <Group align="flex-start" wrap="nowrap" gap="sm">
                          {/* The blue dot is decorative — seen-state is conveyed by the bold
                              text and the offered action. */}
                          <Indicator size={9} offset={3} disabled={n.wasSeen}>
                            <ThemeIcon variant="light" color={meta.color} radius="xl" size="lg">
                              <TypeIcon size={16} />
                            </ThemeIcon>
                          </Indicator>
                          <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                            <Text size="sm" fw={n.wasSeen ? 400 : 600} c={n.wasSeen ? "dimmed" : undefined}>
                              {describeNotification(n, t, i18n.language)}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {formatTimestamp(n.timestamp)}
                            </Text>
                          </Stack>
                          <Group gap={4} wrap="nowrap">
                            {!n.wasSeen && (
                              <Tooltip label={t("notifications.markSeen")}>
                                <ActionIcon
                                  variant="subtle"
                                  onClick={() => markSeen.mutate(n.id)}
                                  loading={markSeen.isPending && markSeen.variables === n.id}
                                  aria-label={t("notifications.markSeenAria", { id: n.id })}
                                >
                                  <IconCheck size={16} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {n.wasSeen && (
                              <Tooltip label={t("notifications.markUnseen")}>
                                <ActionIcon
                                  variant="subtle"
                                  color="gray"
                                  onClick={() => markUnseen.mutate(n.id)}
                                  loading={markUnseen.isPending && markUnseen.variables === n.id}
                                  aria-label={t("notifications.markUnseenAria", { id: n.id })}
                                >
                                  <IconEyeOff size={16} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {n.link && (
                              <Tooltip label={t("notifications.goTo")}>
                                <ActionIcon
                                  variant="subtle"
                                  onClick={() => goTo(n)}
                                  aria-label={t("notifications.goToAria", { id: n.id })}
                                >
                                  <IconExternalLink size={16} />
                                </ActionIcon>
                              </Tooltip>
                            )}
                            <Tooltip label={t("notifications.delete")}>
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                onClick={() => remove.mutate(n.id)}
                                loading={remove.isPending && remove.variables === n.id}
                                aria-label={t("notifications.deleteAria", { id: n.id })}
                              >
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Group>
                      </Box>
                    );
                  })}
                </Box>
              </ScrollArea.Autosize>
            )}
            {totalPages > 1 && (
              <Group justify="flex-end" mt="sm">
                <Pagination size="sm" value={page} onChange={setPage} total={totalPages} />
              </Group>
            )}
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </>
  );
}
