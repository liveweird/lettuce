import { Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { IconMessagePlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import FeedbackTable from "./FeedbackTable";
import { feedbackProvideLink } from "../utils/feedbackLinks";

// Which dashboard tab this screen was opened from, so the "Back to …" link and the
// invalid-id redirect return there. Defaults to managers for older links lacking `from`.
const ORIGIN = {
  managers: { labelKey: "feedback.origin.managers", to: "/?tab=managers" },
  peers: { labelKey: "feedback.origin.peers", to: "/?tab=peers" },
  subordinates: { labelKey: "feedback.origin.subordinates", to: "/?tab=subordinates" },
} as const;

type OriginKey = keyof typeof ORIGIN;

function isOriginKey(value: string | null): value is OriginKey {
  return value != null && value in ORIGIN;
}

// A per-user, two-way feedback view reached from Dashboard → My managers / My peers.
// List 1: feedbacks the other person gave me (them = provider, I = subject) — only the
//   ones I'm allowed to see (the "received" view already enforces that server-side).
// List 2: feedbacks I gave them (I = provider, they = subject) — all statuses.
export default function ManagerFeedbacks() {
  const { t } = useTranslation();
  const params = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const name = searchParams.get("name");
  const fromParam = searchParams.get("from");
  const origin = ORIGIN[isOriginKey(fromParam) ? fromParam : "managers"];

  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;

  if (!idIsValid) return <Navigate to={origin.to} replace />;

  const who = name ?? t("feedback.userFallback", { id: userId });
  // Where the Edit/View/Create detail pages return to: this very screen, keeping the
  // origin so the "Back to …" link stays correct after a round-trip.
  const query = new URLSearchParams();
  if (name) query.set("name", name);
  if (isOriginKey(fromParam)) query.set("from", fromParam);
  const queryString = query.toString();
  const backTo = `/users/${userId}/feedbacks${queryString ? `?${queryString}` : ""}`;

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t("feedback.feedbacksWith", { who })}</Title>
      </Stack>

      <Stack gap="sm">
        <Title order={4}>{t("feedback.fromToYou", { who })}</Title>
        <Text size="sm" c="dimmed">
          {t("feedback.providedAboutYou", { who })}
        </Text>
        <FeedbackTable view="received" providerId={userId} backTo={backTo} />
      </Stack>

      <Stack gap="sm">
        <Title order={4}>{t("feedback.fromYouTo", { who })}</Title>
        <Text size="sm" c="dimmed">
          {t("feedback.providedAbout", { who })}
        </Text>
        <FeedbackTable view="provided" subjectId={userId} backTo={backTo} />
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to={feedbackProvideLink(userId, who, backTo)}
            leftSection={<IconMessagePlus size={16} />}
            aria-label={t("feedback.createFeedbackFor", { who })}
          >
            {t("feedback.createFeedback")}
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}
