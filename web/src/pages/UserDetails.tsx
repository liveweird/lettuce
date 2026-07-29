import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Anchor, Button, SimpleGrid, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
  IconCalendarEvent,
  IconMessagePlus,
  IconMessageQuestion,
  IconMessages,
  IconPlus,
  IconTargetArrow,
  IconUserPlus,
  IconUsersGroup,
} from "@tabler/icons-react";
import { getUserId, listAllTeamMembers, listTeams, listUsers } from "../api/client";
import EmptyState from "../components/EmptyState";
import PersonCard from "../components/PersonCard";
import PersonCardStats, { PeerCardStats } from "../components/PersonCardStats";
import {
  feedbackAskLink,
  feedbackProvideLink,
  feedbackRequestLink,
  userFeedbacksLink,
} from "../utils/feedbackLinks";
import { userGoalsLink } from "../utils/goalLinks";
import { oneOnOneCreateLink, userOneOnOnesLink } from "../utils/oneOnOneLinks";
import { groupTeamRows, type PersonCard as PersonCardData } from "../utils/teamRows";
import { userDetailsLink } from "../utils/userLinks";

const GRID_COLS = { base: 1, sm: 2, lg: 3 };
const PAGE_SIZE = 100;

type Relationship = "manager" | "subordinate" | "peer";

type UserDetailsData = {
  person: PersonCardData;
  /** null = no team relationship to the viewer (an unrelated user, or the viewer themselves). */
  relationship: Relationship | null;
} | null;

// Relationship precedence: their-manager beats my-subordinate beats peer — the first
// caller-relative view containing the user decides the card flavor (and carries exactly
// that flavor's stats, so the card renders like its dashboard counterpart).
const VIEW_TO_RELATIONSHIP = [
  ["managers", "manager"],
  ["managed", "subordinate"],
  ["member", "peer"],
] as const;

async function fetchUserDetails(userId: number): Promise<UserDetailsData> {
  for (const [view, relationship] of VIEW_TO_RELATIONSHIP) {
    const rows = (await listAllTeamMembers(view)).filter((r) => r.userId === userId);
    if (rows.length > 0) return { person: groupTeamRows(rows)[0], relationship };
  }
  // No relationship: the /teams/members views never contain unrelated users (or the caller),
  // so resolve the basics from the open users list and the id-keyed teams filter instead.
  // No stats — the server only computes them for related pairs.
  let page = 1;
  for (;;) {
    const result = await listUsers({ page, pageSize: PAGE_SIZE, sort: "id" });
    const found = result.items.find((u) => u.id === userId);
    if (found) {
      const teams = await listTeams({ page: 1, pageSize: PAGE_SIZE, memberId: userId, sort: "name" });
      return {
        person: {
          userId: found.id,
          name: found.name,
          email: found.email,
          teamNames: teams.items.map((team) => team.name),
          lastOneOnOneDate: null,
          lastOneOnOneOpenItems: null,
          lastFeedbackAt: null,
          lastFeedbackGivenAt: null,
          lastFeedbackReceivedAt: null,
          activeGoalCount: null,
        },
        relationship: null,
      };
    }
    if (page * PAGE_SIZE >= result.total || result.items.length === 0) return null;
    page += 1;
  }
}

// The relationship-aware read-only view of one user: the same person card the Dashboard
// grids render, flavor picked by how the viewed user relates to the viewer. Reached from
// the Users list (`from=users`, the default) and a team's roster (`from=members` + teamId).
export default function UserDetails() {
  const { t } = useTranslation();
  const params = useParams<{ userId: string }>();
  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;
  const [search] = useSearchParams();
  const nameParam = search.get("name");
  const teamIdRaw = Number(search.get("teamId"));
  const teamId = Number.isFinite(teamIdRaw) && teamIdRaw > 0 ? teamIdRaw : undefined;
  // The members origin needs its teamId to link back to that roster; teams is the teams list's
  // manager chip; org is the org-chart canvas. Anything else degrades to the users list.
  const fromParam = search.get("from");
  const originKey: "users" | "members" | "teams" | "org" =
    fromParam === "members" && teamId != null
      ? "members"
      : fromParam === "teams" || fromParam === "org"
        ? fromParam
        : "users";
  const origin =
    originKey === "members"
      ? { labelKey: "feedback.origin.members", to: `/teams/${teamId}/members` }
      : originKey === "teams"
        ? { labelKey: "feedback.origin.teams", to: "/teams" }
        : originKey === "org"
          ? { labelKey: "feedback.origin.org", to: "/org" }
          : { labelKey: "feedback.origin.users", to: "/users" };
  const selfView = userId === getUserId();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["userDetails", userId],
    queryFn: () => fetchUserDetails(userId),
    enabled: idIsValid,
  });

  if (!idIsValid) return <Navigate to="/users" replace />;

  const person = data?.person ?? null;
  const relationship = data?.relationship ?? null;
  const name = person?.name ?? nameParam;
  // Where the create flows' Cancel returns: this page, with its own params preserved.
  const backHere = userDetailsLink(
    userId,
    name,
    originKey,
    originKey === "members" ? teamId : undefined,
  );

  // Undefined (not an empty fragment) when the viewer gets no actions — PersonCard then
  // omits the divider + actions row entirely (the self-view case).
  const actions =
    person == null || selfView ? undefined : relationship === "manager" ? (
      // The /?tab=managers card's actions (users.* labels), returning here instead of the tab.
      <>
        <Button
          component={RouterLink}
          to={feedbackProvideLink(person.userId, person.name, backHere)}
          variant="light"
          size="xs"
          leftSection={<IconMessagePlus size={14} />}
          aria-label={t("users.provideFeedbackTo", { name: person.name })}
        >
          {t("users.provideFeedback")}
        </Button>
        <Button
          component={RouterLink}
          to={feedbackAskLink(person.userId, person.name, backHere)}
          variant="light"
          size="xs"
          leftSection={<IconMessageQuestion size={14} />}
          aria-label={t("users.askForFeedbackFrom", { name: person.name })}
        >
          {t("users.askForFeedback")}
        </Button>
        <Button
          component={RouterLink}
          to={userFeedbacksLink(person.userId, person.name, "managers")}
          variant="subtle"
          size="xs"
          leftSection={<IconMessages size={14} />}
          aria-label={t("users.feedbacksWith", { name: person.name })}
        >
          {t("users.feedbacks")}
        </Button>
        <Button
          component={RouterLink}
          to={userOneOnOnesLink(person.userId, person.name, "managers")}
          variant="subtle"
          size="xs"
          leftSection={<IconCalendarEvent size={14} />}
          aria-label={t("users.oneOnOnesWith", { name: person.name })}
        >
          {t("users.oneOnOnes")}
        </Button>
        <Button
          component={RouterLink}
          to={userGoalsLink(person.userId, person.name, "managers")}
          variant="subtle"
          size="xs"
          leftSection={<IconTargetArrow size={14} />}
          aria-label={t("users.goalsWith", { name: person.name })}
        >
          {t("users.goals")}
        </Button>
      </>
    ) : relationship === "subordinate" ? (
      // The /?tab=subordinates card's actions (teams.* labels) — a found row means a direct
      // report, so the direct-only affordances (New 1:1, 1:1s, Goals) all apply.
      <>
        <Button
          component={RouterLink}
          to={feedbackProvideLink(person.userId, person.name, backHere)}
          variant="light"
          size="xs"
          leftSection={<IconMessagePlus size={14} />}
          aria-label={t("teams.provideFeedbackToAria", { name: person.name })}
        >
          {t("teams.provideFeedback")}
        </Button>
        <Button
          component={RouterLink}
          to={feedbackAskLink(person.userId, person.name, backHere)}
          variant="light"
          size="xs"
          leftSection={<IconMessageQuestion size={14} />}
          aria-label={t("teams.askForFeedbackAria", { name: person.name })}
        >
          {t("teams.askForFeedback")}
        </Button>
        <Button
          component={RouterLink}
          to={feedbackRequestLink(person.userId, person.name, backHere)}
          variant="light"
          size="xs"
          leftSection={<IconUserPlus size={14} />}
          aria-label={t("teams.requestFeedbackAboutAria", { name: person.name })}
        >
          {t("teams.requestFeedbackFor")}
        </Button>
        <Button
          component={RouterLink}
          to={oneOnOneCreateLink(person.userId, person.name, backHere)}
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          aria-label={t("teams.addOneOnOneWithAria", { name: person.name })}
        >
          {t("teams.addOneOnOne")}
        </Button>
        <Button
          component={RouterLink}
          to={userFeedbacksLink(person.userId, person.name, "subordinates")}
          variant="subtle"
          size="xs"
          leftSection={<IconMessages size={14} />}
          aria-label={t("teams.feedbacksWithAria", { name: person.name })}
        >
          {t("teams.feedbacks")}
        </Button>
        <Button
          component={RouterLink}
          to={userOneOnOnesLink(person.userId, person.name, "subordinates")}
          variant="subtle"
          size="xs"
          leftSection={<IconCalendarEvent size={14} />}
          aria-label={t("teams.oneOnOnesWithAria", { name: person.name })}
        >
          {t("teams.oneOnOnes")}
        </Button>
        <Button
          component={RouterLink}
          to={userGoalsLink(person.userId, person.name, "subordinates")}
          variant="subtle"
          size="xs"
          leftSection={<IconTargetArrow size={14} />}
          aria-label={t("teams.goalsForAria", { name: person.name })}
        >
          {t("teams.goals")}
        </Button>
      </>
    ) : (
      // The /?tab=peers card's actions (teams.* labels), for found peers and unrelated users
      // alike; the feedbacks drill-down keeps the peer origin only when a peer row backs it.
      <>
        <Button
          component={RouterLink}
          to={feedbackProvideLink(person.userId, person.name, backHere)}
          variant="light"
          size="xs"
          leftSection={<IconMessagePlus size={14} />}
          aria-label={t("teams.provideFeedbackToAria", { name: person.name })}
        >
          {t("teams.provideFeedback")}
        </Button>
        <Button
          component={RouterLink}
          to={feedbackAskLink(person.userId, person.name, backHere)}
          variant="light"
          size="xs"
          leftSection={<IconMessageQuestion size={14} />}
          aria-label={t("teams.askForFeedbackAria", { name: person.name })}
        >
          {t("teams.askForFeedback")}
        </Button>
        <Button
          component={RouterLink}
          to={userFeedbacksLink(
            person.userId,
            person.name,
            relationship === "peer" ? "peers" : originKey,
            relationship === "peer" ? undefined : teamId,
          )}
          variant="subtle"
          size="xs"
          leftSection={<IconMessages size={14} />}
          aria-label={t("teams.feedbacksWithAria", { name: person.name })}
        >
          {t("teams.feedbacks")}
        </Button>
      </>
    );

  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{name ?? t("users.detailsTitle")}</Title>
        {relationship && (
          <Text size="sm" c="dimmed">
            {t(`users.relationship.${relationship}`)}
          </Text>
        )}
      </Stack>

      {isError ? (
        <Alert color="red" variant="light" title={t("users.loadUserFailed")}>
          {error instanceof Error ? error.message : t("users.unknownError")}
        </Alert>
      ) : isLoading ? (
        <SimpleGrid cols={GRID_COLS} spacing="md">
          <Skeleton height={170} radius="md" />
        </SimpleGrid>
      ) : person ? (
        // The one-card grid keeps the dashboard card's width (and PersonCard's `li` valid).
        <SimpleGrid component="ul" m={0} p={0} style={{ listStyle: "none" }} cols={GRID_COLS} spacing="md">
          <PersonCard
            name={person.name}
            email={person.email}
            teamNames={person.teamNames}
            stats={
              relationship === "manager" || relationship === "subordinate" ? (
                <PersonCardStats person={person} />
              ) : relationship === "peer" ? (
                <PeerCardStats person={person} />
              ) : undefined
            }
            actions={actions}
          />
        </SimpleGrid>
      ) : (
        <EmptyState
          icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
          label={t("users.userNotFound")}
        />
      )}
    </Stack>
  );
}
