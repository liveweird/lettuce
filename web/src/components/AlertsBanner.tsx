import { useEffect, useState } from "react";
import { ActionIcon, Alert, Box, Group, Paper, Text } from "@mantine/core";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconSpeakerphone,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getVisibleAlerts } from "../api/client";
import MarkdownView from "./MarkdownView";
import classes from "./AlertsBanner.module.css";

const STORAGE_KEY = "lettuce.alertsBanner";

type BannerState = { hidden: boolean; seenMaxId: number };

function readState(): BannerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BannerState>;
      return { hidden: parsed.hidden === true, seenMaxId: Number(parsed.seenMaxId) || 0 };
    }
  } catch {
    // Storage unavailable/corrupt — fall through to the default (banner shown).
  }
  return { hidden: false, seenMaxId: 0 };
}

function writeState(state: BannerState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort persistence only.
  }
}

/**
 * The app-wide announcement banner: renders the currently visible alerts (server-decided,
 * refetched every minute) above the page content. The user can hide it to a slim bar and
 * unhide it — never close it. Hidden state persists in localStorage, but a new alert
 * (an unseen id) automatically re-expands the banner.
 */
export default function AlertsBanner() {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(() => readState().hidden);
  const [index, setIndex] = useState(0);

  const { data } = useQuery({
    queryKey: ["visibleAlerts"],
    queryFn: getVisibleAlerts,
    refetchInterval: 60_000,
    staleTime: 60_000,
    retry: false,
  });

  const items = data ?? [];
  const maxId = items.reduce((acc, a) => Math.max(acc, a.id), 0);

  // Auto-unhide when an alert id we have never seen appears; remember it either way.
  useEffect(() => {
    if (maxId === 0) return;
    const stored = readState();
    if (maxId > stored.seenMaxId) {
      writeState({ hidden: false, seenMaxId: maxId });
      setHidden(false);
    }
  }, [maxId]);

  // The banner must never break the app: nothing to show (or a failed fetch) renders nothing.
  if (items.length === 0) return null;

  function toggleHidden(next: boolean) {
    setHidden(next);
    writeState({ hidden: next, seenMaxId: maxId });
  }

  if (hidden) {
    return (
      <Paper bg="orange" c="white" px="md" py={4} radius="sm" mb="md">
        <Group gap="xs" wrap="nowrap">
          <IconSpeakerphone size={16} />
          <Text size="sm" fw={500} style={{ flex: 1 }}>
            {t("alerts.banner.hiddenCount", { count: items.length })}
          </Text>
          <ActionIcon
            variant="transparent"
            c="white"
            size="sm"
            aria-label={t("alerts.banner.show")}
            onClick={() => toggleHidden(false)}
          >
            <IconChevronDown size={16} />
          </ActionIcon>
        </Group>
      </Paper>
    );
  }

  // The visible set can shrink between refetches; clamp instead of indexing past the end.
  const current = items[Math.min(index, items.length - 1)];

  return (
    <Alert
      color="orange"
      variant="filled"
      icon={<IconSpeakerphone size={20} />}
      mb="md"
      styles={{ body: { minWidth: 0 } }}
    >
      <Group gap="xs" wrap="nowrap" align="flex-start">
        {/* Inverted chip (white on the banner's own fill color) so the title stays visually
            senior to any markdown heading in the content without competing on font size. */}
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text
            component="span"
            fw={700}
            size="sm"
            px={10}
            py={3}
            style={{
              display: "inline-block",
              backgroundColor: "var(--mantine-color-white)",
              color: "var(--mantine-color-orange-filled)",
              borderRadius: "var(--mantine-radius-sm)",
            }}
          >
            {current.title}
          </Text>
        </Box>
        {items.length > 1 && (
          <Group gap={4} wrap="nowrap">
            <ActionIcon
              variant="transparent"
              c="white"
              size="sm"
              className={classes.pagerButton}
              disabled={index <= 0}
              aria-label={t("alerts.banner.previous")}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
            <Text size="sm">
              {t("alerts.banner.counter", {
                current: Math.min(index, items.length - 1) + 1,
                total: items.length,
              })}
            </Text>
            <ActionIcon
              variant="transparent"
              c="white"
              size="sm"
              className={classes.pagerButton}
              disabled={index >= items.length - 1}
              aria-label={t("alerts.banner.next")}
              onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
            >
              <IconChevronRight size={16} />
            </ActionIcon>
          </Group>
        )}
        <ActionIcon
          variant="transparent"
          c="white"
          size="sm"
          aria-label={t("alerts.banner.hide")}
          onClick={() => toggleHidden(true)}
        >
          <IconChevronUp size={16} />
        </ActionIcon>
      </Group>
      <MarkdownView>{current.content}</MarkdownView>
    </Alert>
  );
}
