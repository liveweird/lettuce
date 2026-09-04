import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, Navigate } from "react-router-dom";
import {
  Alert,
  Anchor,
  Box,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Timeline
} from "@mantine/core";
import { useIntersection } from "@mantine/hooks";
import { IconConfetti, IconPlus } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature } from "../api/session";
import { listFeedbacks, type FeedbackPage } from "../api/feedbacks";
import EmptyState from "../components/EmptyState";
import MarkdownView from "../components/MarkdownView";
import PersonCell from "../components/PersonCell";
import { formatRelativeTime, formatTimestamp } from "../utils/datetime";
import { feedbackSubjects } from "../utils/feedbackSubjects";
import { loadErrorMessage } from "../utils/saveError";
import PageHeader from "../components/PageHeader";
import CenteredLoader from "../components/CenteredLoader";

const PAGE_SIZE = 20;
const PREVIEW_LINES = 3;

type KudosItem = FeedbackPage["items"][number];

function KudosCard({ item }: { item: KudosItem }) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const clampRef = useRef<HTMLDivElement>(null);
  const userId = getUserId();
  // Kudos rows carry the full content; the preview is the defensive fallback only.
  const content = item.content ?? item.contentPreview;

  // Whether the clamped preview actually hides anything — measured on the collapsed render.
  // Content that fits entirely gets no toggle: the card stays non-interactive.
  useEffect(() => {
    const el = clampRef.current;
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [content]);

  return (
    <Stack gap={4}>
      <Group gap={8} wrap="wrap">
        <PersonCell
          userId={item.providerId}
          name={item.providerName}
          deleted={item.providerDeleted}
          currentUserId={userId}
        />
        <Text size="sm" c="dimmed">
          →
        </Text>
        {feedbackSubjects(item).map((subject) => (
          <PersonCell
            key={subject.id}
            userId={subject.id}
            name={subject.name}
            deleted={subject.deleted}
            currentUserId={userId}
          />
        ))}
      </Group>
      <Text size="xs" c="dimmed" title={formatTimestamp(item.lastModified)}>
        {formatRelativeTime(item.lastModified, i18n.language)}
      </Text>
      {/* Always the rendered markdown; collapsing only clamps the same rendering to the
          preview lines instead of swapping to raw text. The kudo's own bordered card is the
          frame (v3.4.0) — no inner ProseBox. */}
        <Box
          ref={clampRef}
          style={
            expanded
              ? undefined
              : {
                  display: "-webkit-box",
                  WebkitLineClamp: PREVIEW_LINES,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden"
                }
          }
        >
          <MarkdownView>{content}</MarkdownView>
        </Box>
      {(overflowing || expanded) && (
        <Anchor
          component="button"
          type="button"
          size="xs"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          style={{ alignSelf: "flex-start" }}
        >
          {expanded ? t("kudos.showLess") : t("kudos.showMore")}
        </Anchor>
      )}
    </Stack>
  );
}

/**
 * The org-wide Kudos wall (v2.2.0): every PUBLIC feedback in SENT status, newest first, as an
 * infinite-scroll timeline — the discoverability surface for public feedback (nothing else
 * ever lists it org-wide). No filters, no pagination bar: scrolling near the bottom loads the
 * next (older) page via the sentinel below. Part of the FEEDBACKS feature area.
 */
export default function Kudos() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["feedbacks", "kudos"],
      queryFn: ({ pageParam }) =>
        listFeedbacks({ view: "kudos", sort: "-lastModified", page: pageParam, pageSize: PAGE_SIZE }),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined)
    });
  // rootMargin pre-loads the next page shortly before the sentinel actually scrolls into view.
  const { ref: sentinelRef, entry } = useIntersection({ rootMargin: "200px" });

  useEffect(() => {
    if (entry?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [entry, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("FEEDBACKS")) return <Navigate to="/" replace />;

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Container size="md" px={0}>
      {/* The sticky page header (v2.27.0; PageHeader since v3.3.0): title, hint, and the
          create entry point stay pinned under the app header while the wall scrolls. */}
      <PageHeader
        sticky
        mb="md"
        title={t("kudos.title")}
        description={t("kudos.hint")}
        actions={
          <Button component={RouterLink} to="/kudos/new" leftSection={<IconPlus size={16} />}>
            {t("kudos.newButton")}
          </Button>
        }
      />
        <Stack gap="md">
          {isError && (
            <Alert color="red" variant="light" title={t("kudos.loadError")}>
              {loadErrorMessage(error, t)}
            </Alert>
          )}
          {isLoading && <CenteredLoader />}

          {data && items.length === 0 && (
            <EmptyState
              icon={<IconConfetti size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
              label={t("kudos.empty")}
            />
          )}
          {items.length > 0 && (
            <Timeline bulletSize={12} lineWidth={2}>
              {items.map((item) => (
                <Timeline.Item key={item.id}>
                  <Paper withBorder radius="md" p="md">
                    <KudosCard item={item} />
                  </Paper>
                </Timeline.Item>
              ))}
            </Timeline>
          )}

          {/* The scroll sentinel: entering the viewport fetches the next (older) page. */}
          {hasNextPage && !isFetchingNextPage && <Box ref={sentinelRef} h={1} data-testid="kudos-sentinel" />}
          {isFetchingNextPage && <CenteredLoader size="sm" />}
        </Stack>
    </Container>
  );
}
