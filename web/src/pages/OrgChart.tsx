import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { IconChevronDown, IconChevronRight, IconUsersGroup } from "@tabler/icons-react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getUserId } from "../api/session";
import { listAllUsers } from "../api/users";
import { listAllTeams } from "../api/teams";
import DateField from "../components/DateField";
import EmptyState from "../components/EmptyState";
import InactivePill from "../components/InactivePill";
import PersonaChip from "../components/PersonaChip";
import {
  applyCollapse,
  buildOrgGraph,
  layoutOrgGraph,
  PERSON_NODE_SIZE,
  SECTION_NODE_SIZE,
  TEAM_NODE_SIZE,
  type OrgMembership,
} from "../utils/orgGraph";
import { formatIsoDate, isValidIsoDate, todayIsoDate } from "../utils/datetime";
import { teamDetailsLink } from "../utils/teamLinks";
import { userDetailsLink } from "../utils/userLinks";
import { loadErrorMessage } from "../utils/saveError";

// The whole org, composed client-side from the open lists (the house aggregation pattern):
// teams + managers + memberIds from the teams list (rows carry memberIds since v4.14.0 — no
// per-team fetch), names from the users list; the two loops run in parallel.
// Returns the raw graph — layout runs in the component, downstream of the collapse state.
async function fetchOrg(asOf: string) {
  if (asOf === todayIsoDate()) {
    const [teams, users] = await Promise.all([listAllTeams(), listAllUsers()]);
    const memberships: OrgMembership[] = teams.map((t) => ({ teamId: t.id, memberIds: t.memberIds }));
    const usersById = new Map(users.map((u) => [u.id, u.name]));
    const deactivatedIds = new Set(users.filter((u) => u.deactivated).map((u) => u.id));
    return buildOrgGraph(teams, memberships, usersById, deactivatedIds);
  }
  // Another day (v4.17.0): the structure comes from the as-of teams list, whose rows name the
  // roster (people since deleted are absent from today's directory); today's users only supply
  // the "Not in any team" section — the people the as-of rosters do not place.
  const [teams, users] = await Promise.all([listAllTeams({ asOf }), listAllUsers()]);
  const memberships: OrgMembership[] = teams.map((t) => ({ teamId: t.id, memberIds: t.memberIds }));
  const usersById = new Map(users.map((u) => [u.id, u.name]));
  const deactivatedIds = new Set(users.filter((u) => u.deactivated).map((u) => u.id));
  const deletedIds = new Set<number>();
  for (const team of teams) {
    for (const member of team.members ?? []) {
      usersById.set(member.id, member.name);
      if (member.deleted) deletedIds.add(member.id);
      if (member.deactivated) deactivatedIds.add(member.id);
      else deactivatedIds.delete(member.id);
    }
  }
  return buildOrgGraph(teams, memberships, usersById, deactivatedIds, deletedIds);
}

type PersonNodeType = Node<
  { userId: number; name: string; deleted: boolean; deactivated: boolean; self: boolean },
  "person"
>;
type TeamNodeType = Node<
  {
    teamId: number;
    name: string;
    collapsed: boolean;
    deleted: boolean;
    /** Where the team page's Back returns to when the chart is off today (`/org?asOf=…`). */
    backTo: string | undefined;
    memberCount: number;
    onToggle: () => void;
  },
  "team"
>;

// Invisible connection points — the chart is read-only, the handles exist only so edges anchor.
const HANDLE_STYLE = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: "none",
} as const;

function PersonNode({ data }: NodeProps<PersonNodeType>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const body = data.deleted ? (
    <Text size="sm" c="dimmed" truncate>
      {data.name} {t("org.deletedTag")}
    </Text>
  ) : data.deactivated ? (
    // A deactivated person: dimmed name (the AA-guarded dimmed token) + the Inactive pill.
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0, maxWidth: "100%" }}>
      <PersonaChip name={data.name} dimmed />
      <InactivePill />
    </Group>
  ) : (
    <PersonaChip name={data.name} />
  );
  return (
    <Paper
      withBorder
      radius="md"
      px="sm"
      // A deactivated person's node is visibly different: the quiet tint surface (the same
      // token pair the filter panel uses) and a dashed border — never opacity, which would
      // drag the name's contrast under AA.
      bg={data.deactivated ? "var(--lettuce-surface-tint)" : undefined}
      style={{
        width: PERSON_NODE_SIZE.width,
        height: PERSON_NODE_SIZE.height,
        display: "flex",
        alignItems: "center",
        ...(data.deactivated ? { borderStyle: "dashed" } : {}),
      }}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} isConnectable={false} />
      {data.deleted || data.self ? (
        body
      ) : (
        // Clickable like the lists' User-details buttons — same aria wording; one's own node
        // stays plain (the own-row convention: no self relationship to show).
        <UnstyledButton
          onClick={() => navigate(userDetailsLink(data.userId, data.name, "org"))}
          aria-label={t("users.detailsFor", { name: data.name })}
          style={{ minWidth: 0 }}
        >
          {body}
        </UnstyledButton>
      )}
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} isConnectable={false} />
    </Paper>
  );
}

function TeamNode({ data }: NodeProps<TeamNodeType>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Paper
      withBorder
      radius="md"
      px="sm"
      style={{
        width: TEAM_NODE_SIZE.width,
        height: TEAM_NODE_SIZE.height,
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderColor: "var(--mantine-color-lettuce-filled)",
        // A team deleted since the chart's date: dashed and quiet (never opacity — contrast).
        ...(data.deleted
          ? { borderStyle: "dashed", borderColor: "var(--mantine-color-dimmed)" }
          : {}),
      }}
    >
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} isConnectable={false} />
      {/* Tree-style expander before the name; teams with no members have nothing to fold. */}
      {data.memberCount > 0 && !data.deleted && (
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={data.onToggle}
          aria-label={t(data.collapsed ? "org.expandAria" : "org.collapseAria", {
            name: data.name,
          })}
        >
          {data.collapsed ? <IconChevronRight size={16} /> : <IconChevronDown size={16} />}
        </ActionIcon>
      )}
      {data.deleted ? (
        // A team deleted since the chart's date has no live page to open and nothing to fold:
        // plain, dimmed text; its members stay on the chart.
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <IconUsersGroup size={18} color="var(--mantine-color-dimmed)" />
          <Text size="sm" fw={600} truncate c="dimmed">
            {data.name} {t("org.deletedTeamTag")}
          </Text>
        </Group>
      ) : (
        <UnstyledButton
          onClick={() => navigate(teamDetailsLink(data.teamId, { from: "org", back: data.backTo }))}
          aria-label={t("teams.membersOfAria", { name: data.name })}
          style={{ minWidth: 0 }}
        >
          <Group gap="xs" wrap="nowrap">
            <IconUsersGroup size={18} color="var(--mantine-color-lettuce-filled)" />
            <Text size="sm" fw={600} truncate>
              {data.name}
            </Text>
          </Group>
        </UnstyledButton>
      )}
      {data.collapsed && (
        <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
          {t("org.hiddenMembers", { n: data.memberCount })}
        </Text>
      )}
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} isConnectable={false} />
    </Paper>
  );
}

// The dimmed heading over the "Not in any team" rows (people the layout parked below the
// chart). Pure label — no handles, no click.
function SectionNode() {
  const { t } = useTranslation();
  return (
    <Text
      size="sm"
      fw={600}
      c="dimmed"
      style={{ width: SECTION_NODE_SIZE.width, height: SECTION_NODE_SIZE.height }}
    >
      {t("org.unattachedLabel")}
    </Text>
  );
}

// Module-scope so React Flow doesn't re-register node types every render.
const NODE_TYPES = { person: PersonNode, team: TeamNode, section: SectionNode };

const MANAGES_STROKE = "var(--mantine-color-lettuce-filled)";
const MEMBER_STROKE = "var(--mantine-color-dimmed)";

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={22} h={0} style={{ borderTop: `2px solid ${color}` }} />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}

export default function OrgChart() {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  // The chart's date lives in `?asOf=` (v4.17.0): absent, malformed or today = the live chart.
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayIsoDate();
  const asOfParam = searchParams.get("asOf");
  const asOf = asOfParam != null && isValidIsoDate(asOfParam) ? asOfParam : today;
  const offToday = asOf !== today;
  function setAsOf(iso: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (iso === "" || iso === today) next.delete("asOf");
        else next.set("asOf", iso);
        return next;
      },
      { replace: true },
    );
  }
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["orgChart", asOf],
    queryFn: () => fetchOrg(asOf),
  });

  // Collapsed team node ids — client-side view state only, everything expanded by default.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleTeam = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Collapse first, then lay out what's left — collapsing re-runs dagre on the visible subgraph.
  const visible = useMemo(() => {
    if (data == null) return null;
    const filtered = applyCollapse(data.nodes, data.edges, collapsed);
    return { positioned: layoutOrgGraph(filtered.nodes, filtered.edges), edges: filtered.edges };
  }, [data, collapsed]);
  // Member counts come from the FULL graph so a collapsed team still states what it hides.
  const memberCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of data?.edges ?? []) {
      if (e.kind === "member") counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
    }
    return counts;
  }, [data]);

  const rfNodes: Node[] = useMemo(
    () =>
      (visible?.positioned ?? []).map((n) =>
        n.kind === "person"
          ? ({
              id: n.id,
              type: "person",
              position: { x: n.x, y: n.y },
              data: {
                userId: n.userId,
                name: n.name,
                deleted: n.deleted,
                deactivated: n.deactivated,
                self: n.userId === currentUserId,
              },
              draggable: false,
            } satisfies Node)
          : n.kind === "team"
            ? ({
                id: n.id,
                type: "team",
                position: { x: n.x, y: n.y },
                data: {
                  teamId: n.teamId,
                  name: n.name,
                  collapsed: collapsed.has(n.id),
                  deleted: n.deleted,
                  backTo: offToday ? `/org?asOf=${asOf}` : undefined,
                  memberCount: memberCounts.get(n.id) ?? 0,
                  onToggle: () => toggleTeam(n.id),
                },
                draggable: false,
              } satisfies Node)
            : ({
                id: n.id,
                type: "section",
                position: { x: n.x, y: n.y },
                data: {},
                draggable: false,
                selectable: false, // a plain label — nothing to click (cf. the note below)
              } satisfies Node),
      ),
    [visible, collapsed, memberCounts, currentUserId, toggleTeam, offToday, asOf],
  );
  const rfEdges: Edge[] = useMemo(
    () =>
      (visible?.edges ?? []).map((e) => {
        const stroke = e.kind === "manages" ? MANAGES_STROKE : MEMBER_STROKE;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          style: { stroke, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        };
      }),
    [visible],
  );

  // Re-fit after a collapse/expand: dagre reflows the whole chart, so without this the nodes
  // shift out from under the viewport. The initial fit stays the `fitView` prop's job.
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  useEffect(() => {
    void rfInstance.current?.fitView({ duration: 200 });
  }, [collapsed]);

  return (
    <Stack gap="md" h="100%">
      <Stack gap={4}>
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Title order={2}>
            {t("org.title")}
          </Title>
          <Group gap="md">
            <LegendSwatch color={MANAGES_STROKE} label={t("org.legendManages")} />
            <LegendSwatch color={MEMBER_STROKE} label={t("org.legendMember")} />
          </Group>
        </Group>
        <Text size="sm" c="dimmed">
          {t("org.hint")}
        </Text>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <DateField
            label={t("org.asOf")}
            value={offToday ? asOf : today}
            onChange={setAsOf}
            w={170}
          />
          {offToday && (
            <>
              <Badge variant="light" color="lettuce" style={{ textTransform: "none" }}>
                {t("org.asOfDate", { date: formatIsoDate(asOf, i18n.language) })}
              </Badge>
              <Button size="compact-xs" variant="light" onClick={() => setAsOf(today)}>
                {t("org.backToToday")}
              </Button>
              <Text size="xs" c="dimmed">
                {t("org.asOfUnattachedHint")}
              </Text>
            </>
          )}
        </Group>
      </Stack>

      {isError ? (
        <Alert color="red" variant="light" title={t("org.loadFailed")}>
          {loadErrorMessage(error, t)}
        </Alert>
      ) : isLoading ? (
        <Center mih={300}>
          <Loader />
        </Center>
      ) : rfNodes.length === 0 ? (
        <EmptyState
          icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
          label={t(offToday ? "org.emptyAsOf" : "org.empty")}
        />
      ) : (
        <Box style={{ height: "calc(100vh - 240px)", minHeight: 420 }}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
            onInit={(instance) => {
              rfInstance.current = instance;
            }}
            fitView
            nodesDraggable={false}
            nodesConnectable={false}
            // Nodes must stay selectable: React Flow gives non-draggable, non-selectable nodes
            // pointer-events:none, which would swallow the person/team buttons' clicks.
            minZoom={0.2}
          >
            <Controls showInteractive={false} />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          </ReactFlow>
        </Box>
      )}
    </Stack>
  );
}
