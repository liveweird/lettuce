import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Anchor, Group, Paper, SimpleGrid, Skeleton, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { IconUsersGroup } from "@tabler/icons-react";
import { canAudit, getUserId } from "../api/session";
import { listUsers, type UserPage } from "../api/users";
import { listAllTeamMembers, listTeams } from "../api/teams";
import EmptyState from "../components/EmptyState";
import PersonCard from "../components/PersonCard";
import PersonCardActions, { type PersonCardActionsProps } from "../components/PersonCardActions";
import { hasVisibleActions } from "../components/personCardSupport";
import PersonCardBody from "../components/PersonCardStats";
import { groupTeamRows, type PersonCard as PersonCardData } from "../utils/teamRows";
import { userDetailsLink } from "../utils/userLinks";
import { loadErrorMessage } from "../utils/saveError";

// Matches the dashboard card grids' v1.34.0 cap (2 per row) so the single details card
// renders at the same width as its dashboard counterparts.
const GRID_COLS = { base: 1, sm: 2 };
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

// Pages through the open users list until the user's row turns up (the no-relationship
// fallback — the /teams/members views never contain unrelated users or the caller).
async function findUser(userId: number): Promise<UserPage["items"][number] | null> {
  let page = 1;
  for (;;) {
    const result = await listUsers({ page, pageSize: PAGE_SIZE, sort: "id" });
    const found = result.items.find((u) => u.id === userId);
    if (found) return found;
    if (page * PAGE_SIZE >= result.total || result.items.length === 0) return null;
    page += 1;
  }
}

async function fetchUserDetails(userId: number): Promise<UserDetailsData> {
  for (const [view, relationship] of VIEW_TO_RELATIONSHIP) {
    // Rows carry the dashboard stats AND the career profile (v1.32.1) — one fetch per view.
    const rows = (await listAllTeamMembers(view)).filter((r) => r.userId === userId);
    if (rows.length > 0) return { person: groupTeamRows(rows)[0], relationship };
  }
  // No relationship: resolve the basics from the open users list and the id-keyed teams
  // filter instead. No stats — the server only computes them for related pairs — but the
  // career profile rides the users-list row.
  const found = await findUser(userId);
  if (found == null) return null;
  const teams = await listTeams({ page: 1, pageSize: PAGE_SIZE, memberId: userId, sort: "name" });
  return {
    person: {
      userId: found.id,
      name: found.name,
      email: found.email,
      teams: teams.items.map((team) => ({ id: team.id, name: team.name })),
      teamNames: teams.items.map((team) => team.name),
      lastOneOnOneDate: null,
      lastOneOnOneOpenItems: null,
      lastFeedbackAt: null,
      lastFeedbackGivenAt: null,
      lastFeedbackReceivedAt: null,
      activeGoalCount: null,
      lastReviewId: null,
      lastReviewPeriodStartMonth: null,
      lastReviewPeriodEndMonth: null,
      lastReviewStatus: null,
      careerPath: found.careerPath,
      careerSpecialization: found.careerSpecialization,
      seniorityLevel: found.seniorityLevel,
      nextVacationStart: null,
      daysOffRemaining: null,
    },
    relationship: null,
  };
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
  // manager chip; org is the org-chart canvas; career is the Career page's Team pyramid tab
  // (v2.16.0). Anything else degrades to the users list.
  const fromParam = search.get("from");
  const originKey: "users" | "members" | "teams" | "org" | "career" =
    fromParam === "members" && teamId != null
      ? "members"
      : fromParam === "teams" || fromParam === "org" || fromParam === "career"
        ? fromParam
        : "users";
  const origin: { labelKey: ParseKeys; to: string } =
    originKey === "members"
      ? { labelKey: "feedback.origin.members", to: `/teams/${teamId}/details` }
      : originKey === "teams"
        ? { labelKey: "feedback.origin.teams", to: "/teams" }
        : originKey === "org"
          ? { labelKey: "feedback.origin.org", to: "/org" }
          : originKey === "career"
            ? { labelKey: "feedback.origin.career", to: "/career?tab=pyramid" }
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

  // Undefined when the viewer gets no actions — PersonCardBody then renders no buttons at
  // all (the self-view case). Every drill-down carries `from=details` + `back=backHere`
  // (v1.39.0): the round-trip returns HERE with this page's own origin intact, whatever
  // screen the details page itself was reached from.
  const actions: PersonCardActionsProps | undefined =
    person == null || selfView
      ? undefined
      : relationship === "manager"
        ? {
            // The /?tab=managers card's actions (users.* labels), returning here instead
            // of the tab.
            userId: person.userId,
            name: person.name,
            labels: "users",
            back: backHere,
            drillFrom: "details",
            drillBack: backHere,
            // The career timeline is self/chain/HR-only since v2.25.0 — auditors only here.
            show: {
              career: canAudit(),
              provide: true,
              ask: true,
              feedbacks: true,
              oneOnOnes: true,
              goals: true,
            },
          }
        : relationship === "subordinate"
          ? {
              // The /?tab=subordinates card's actions (teams.* labels) — a found row means
              // a direct report, so the direct-only affordances all apply; `manages` keeps
              // them on the drill-downs (the details origin alone can't prove the
              // relationship).
              userId: person.userId,
              name: person.name,
              labels: "teams",
              back: backHere,
              drillFrom: "details",
              drillBack: backHere,
              manages: true,
              show: {
                career: true,
                provide: true,
                ask: true,
                request: true,
                newOneOnOne: true,
                feedbacks: true,
                oneOnOnes: true,
                goals: true,
                reviews: true,
                daysOff: true,
              },
            }
          : {
              // The /?tab=peers card's actions (teams.* labels), for found peers and
              // unrelated users alike.
              userId: person.userId,
              name: person.name,
              labels: "teams",
              back: backHere,
              drillFrom: "details",
              drillBack: backHere,
              // Career timeline: peers/unrelated lost the read in v2.25.0 — auditors only.
              show: { career: canAudit(), provide: true, ask: true, feedbacks: true },
            };

  // Whether any audit drill-down survives the viewer's feature flags (v1.53.0) — with all
  // five features disabled the HR-audit block renders nothing, so it should not exist.
  const auditBlockHasActions = hasVisibleActions(
    {
      labels: "users",
      audit: true,
      show: { feedbacks: true, oneOnOnes: true, goals: true, reviews: true, daysOff: true },
    },
    ["feedbacks", "oneOnOnes", "goals", "reviews", "daysOff"],
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
        <Alert color="red" variant="light" title={t("users.loadUserFailed", { suffix: "" })}>
          {loadErrorMessage(error, t)}
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
            teams={person.teams}
            body={
              // Only view=managed rows carry the last-review and days-off stats, so those
              // sections show for a direct report and not for a manager (whose row never
              // has the data). Self/unrelated get no relationship stats, but the Profile
              // section always shows.
              <PersonCardBody
                person={person}
                stats={relationship ?? "none"}
                showSeniorityWhenUnset={relationship === "subordinate" || selfView}
                showLastReview={relationship === "subordinate"}
                showDaysOff={relationship === "subordinate"}
                actions={actions}
              />
            }
          />
        </SimpleGrid>
      ) : (
        <EmptyState
          icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
          label={t("users.userNotFound")}
        />
      )}

      {canAudit() && !selfView && person != null && auditBlockHasActions && (
        // The HR auditor entry point: read-only drill-downs into EVERYTHING this person
        // is a party to (both directions, every status), regardless of the viewer's own
        // relationship to them. Server-side this is view=user; HR usage is audit-logged.
        // Feature flags bind HR too (v1.53.0) — a disabled feature drops its drill-down,
        // and with all five disabled the whole block goes.
        <Paper withBorder p="md" radius="md">
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              {t("users.audit.title")}
            </Text>
            <Text size="sm" c="dimmed">
              {t("users.audit.hint", { name: person.name })}
            </Text>
            <Group gap="xs">
              <PersonCardActions
                userId={person.userId}
                name={person.name}
                labels="users"
                drillFrom="details"
                drillBack={backHere}
                audit
                show={{ feedbacks: true, oneOnOnes: true, goals: true, reviews: true, daysOff: true, impactLog: true }}
              />
            </Group>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
