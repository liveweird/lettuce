import type { ParseKeys } from "i18next";
import { Button, Group, Stack, Tabs, Text } from "@mantine/core";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { IconMessagePlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { canAudit, hasFeature } from "../api/session";
import PageHeader from "../components/PageHeader";
import { useUserDisplayName } from "../hooks/useDashboardDrillDown";
import FeedbackTable from "./FeedbackTable";
import { feedbackProvideLink, userFeedbacksLink } from "../utils/feedbackLinks";
import { userDetailsLink } from "../utils/userLinks";
import { parsePositiveInt } from "../utils/parse";
import { safeBackParam } from "../utils/url";

// Which screen this one was opened from (a Dashboard tab, the Users list, or a team's members
// roster), so the "Back to …" link and the invalid-id redirect return there. Defaults to managers
// for older links lacking `from`.
const ORIGIN = {
  managers: { labelKey: "feedback.origin.managers", to: "/?tab=managers" },
  peers: { labelKey: "feedback.origin.peers", to: "/?tab=peers" },
  subordinates: { labelKey: "feedback.origin.subordinates", to: "/?tab=subordinates" },
  users: { labelKey: "feedback.origin.users", to: "/users" },
  // `members` and `team` have no static target — they need the `teamId` param; see resolveOrigin.
  members: { labelKey: "feedback.origin.members", to: "/teams" },
  team: { labelKey: "feedback.origin.team", to: "/teams" },
  // `details` needs the userId — resolved separately in the component (the audit entry point).
  details: { labelKey: "feedback.origin.details", to: "/users" },
} as const;

type OriginKey = keyof typeof ORIGIN;

function isOriginKey(value: string | null): value is OriginKey {
  return value != null && value in ORIGIN;
}

// The `members` (team roster) and `team` (the team page's subordinates grid) origins are only
// usable with a valid teamId — their back targets are that team's screens; without one they
// degrade to the default `managers` origin.
function resolveOrigin(
  fromParam: string | null,
  teamId: number | null,
): { labelKey: ParseKeys; to: string } {
  const parameterized = fromParam === "members" || fromParam === "team";
  const key: OriginKey =
    isOriginKey(fromParam) && (!parameterized || teamId != null) ? fromParam : "managers";
  if (key === "members") return { labelKey: ORIGIN.members.labelKey, to: `/teams/${teamId}/details` };
  if (key === "team") return { labelKey: ORIGIN.team.labelKey, to: `/teams/${teamId}/details` };
  return ORIGIN[key];
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
  const teamId = parsePositiveInt(searchParams.get("teamId"));

  const requestedTab = searchParams.get("tab");
  const activeTab: DirectionTab = isDirectionTab(requestedTab) ? requestedTab : "received";

  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;
  // The heading's name comes from the user pool (the useDashboardDrillDown rule): the URL's
  // `name` is only the pre-load hint, and still threads through the rebuilt links below.
  const displayName = useUserDisplayName(userId, name, idIsValid);
  // Explicit return override (the details-page round-trip — the useDashboardDrillDown rule);
  // the origin key still names the label. In-app paths only.
  const backParam = safeBackParam(searchParams);
  const backOverride = backParam?.startsWith("/") ? backParam : null;
  const resolved =
    fromParam === "details" && idIsValid
      ? { labelKey: ORIGIN.details.labelKey, to: userDetailsLink(userId, name) }
      : resolveOrigin(fromParam, teamId);
  const origin = backOverride ? { labelKey: resolved.labelKey, to: backOverride } : resolved;
  // Non-auditors silently fall back to the pair tabs (the EditGoal self-heal spirit).
  const auditMode = searchParams.get("mode") === "audit" && canAudit();

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("FEEDBACKS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={origin.to} replace />;

  function selectTab(value: string | null) {
    if (!isDirectionTab(value)) return;
    // The functional form preserves the other params (name/from/teamId).
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  const who = displayName ?? t("feedback.userFallback", { id: userId });
  const backLink = { to: origin.to, label: t("feedback.backToLabel", { label: t(origin.labelKey) }) };
  // Where the Edit/View/Create detail pages return to: this very screen, keeping the
  // origin — and the active tab, so a round-trip lands back on the direction it started
  // from — so the "Back to …" link stays correct after a round-trip.
  const backTo = userFeedbacksLink(
    userId,
    name,
    isOriginKey(fromParam) ? fromParam : undefined,
    teamId ?? undefined,
    auditMode ? undefined : activeTab,
    auditMode,
    { back: backOverride ?? undefined },
  );

  if (auditMode) {
    // The HR auditor view: one table with everything this person is a party to
    // (either direction, every status), read-only — replaces the two pair tabs.
    return (
      <Stack gap="md">
        <PageHeader
          back={backLink}
          title={t("feedback.feedbacksAudit", { who })}
          description={t("feedback.feedbacksAuditHint", { who })}
        />
        <FeedbackTable
          view="user"
          userId={userId}
          backTo={backTo}
          settingsKey="managerFeedbacks.audit"
        />
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <PageHeader back={backLink} title={t("feedback.feedbacksWith", { who })} />

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
                to={feedbackProvideLink(userId, backTo)}
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
