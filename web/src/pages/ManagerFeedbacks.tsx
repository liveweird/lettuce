import { Anchor, Button, Group, Stack, Tabs, Text, Title } from "@mantine/core";
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

const TABS = ["received", "provided"] as const;
type DirectionTab = (typeof TABS)[number];

function isDirectionTab(value: string | null): value is DirectionTab {
  return TABS.includes(value as DirectionTab);
}

// A per-user, two-way feedback view reached from Dashboard → My managers / My peers /
// My subordinates, one direction per tab:
// "From them to you": feedbacks the other person gave me (them = provider, I = subject) —
//   only the ones I'm allowed to see (the "received" view already enforces that server-side).
// "From you to them": feedbacks I gave them (I = provider, they = subject) — all statuses.
export default function ManagerFeedbacks() {
  const { t } = useTranslation();
  const params = useParams<{ userId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const name = searchParams.get("name");
  const fromParam = searchParams.get("from");
  const origin = ORIGIN[isOriginKey(fromParam) ? fromParam : "managers"];

  const requestedTab = searchParams.get("tab");
  const activeTab: DirectionTab = isDirectionTab(requestedTab) ? requestedTab : "received";

  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;

  if (!idIsValid) return <Navigate to={origin.to} replace />;

  function selectTab(value: string | null) {
    if (!isDirectionTab(value)) return;
    // The functional form preserves the other params (name/from).
    setSearchParams((current) => {
      current.set("tab", value);
      return current;
    });
  }

  const who = name ?? t("feedback.userFallback", { id: userId });
  // Where the Edit/View/Create detail pages return to: this very screen, keeping the
  // origin — and the active tab, so a round-trip lands back on the direction it started
  // from — so the "Back to …" link stays correct after a round-trip.
  const query = new URLSearchParams();
  if (name) query.set("name", name);
  if (isOriginKey(fromParam)) query.set("from", fromParam);
  query.set("tab", activeTab);
  const backTo = `/users/${userId}/feedbacks?${query.toString()}`;

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t("feedback.feedbacksWith", { who })}</Title>
      </Stack>

      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="received">{t("feedback.fromToYou", { who })}</Tabs.Tab>
          <Tabs.Tab value="provided">{t("feedback.fromYouTo", { who })}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="received" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {t("feedback.providedAboutYou", { who })}
            </Text>
            <FeedbackTable
              view="received"
              providerId={userId}
              backTo={backTo}
              settingsKey="managerFeedbacks.received"
            />
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="provided" pt="md">
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {t("feedback.providedAbout", { who })}
            </Text>
            <FeedbackTable
              view="provided"
              subjectId={userId}
              backTo={backTo}
              settingsKey="managerFeedbacks.provided"
            />
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
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
