import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Center, Group, Loader, Paper, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { IconUsersGroup } from "@tabler/icons-react";
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getUserId } from "../api/session";
import { listAllUsers } from "../api/users";
import { getTeam, listAllTeams } from "../api/teams";
import EmptyState from "../components/EmptyState";
import PersonaChip from "../components/PersonaChip";
import {
  buildOrgGraph,
  layoutOrgGraph,
  PERSON_NODE_SIZE,
  SECTION_NODE_SIZE,
  TEAM_NODE_SIZE,
  type OrgMembership,
} from "../utils/orgGraph";
import { userDetailsLink } from "../utils/userLinks";

// The whole org, composed client-side from the open lists (the house aggregation pattern):
// teams + managers from the teams list, memberIds per team, names from the users list.
async function fetchOrg() {
  const teams = await listAllTeams();
  const [memberships, users] = await Promise.all([
    Promise.all(
      teams.map(
        async (team): Promise<OrgMembership> => ({
          teamId: team.id,
          memberIds: (await getTeam(team.id)).memberIds,
        }),
      ),
    ),
    listAllUsers(),
  ]);
  const usersById = new Map(users.map((u) => [u.id, u.name]));
  const { nodes, edges } = buildOrgGraph(teams, memberships, usersById);
  return { positioned: layoutOrgGraph(nodes, edges), edges };
}

type PersonNodeType = Node<
  { userId: number; name: string; deleted: boolean; self: boolean },
  "person"
>;
type TeamNodeType = Node<{ teamId: number; name: string }, "team">;

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
  ) : (
    <PersonaChip name={data.name} />
  );
  return (
    <Paper
      withBorder
      radius="md"
      px="sm"
      style={{
        width: PERSON_NODE_SIZE.width,
        height: PERSON_NODE_SIZE.height,
        display: "flex",
        alignItems: "center",
      }}
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
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
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} isConnectable={false} />
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
        borderColor: "var(--mantine-color-lettuce-filled)",
      }}
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} isConnectable={false} />
      <UnstyledButton
        onClick={() => navigate(`/teams/${data.teamId}/details?from=org`)}
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
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} isConnectable={false} />
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
  const { t } = useTranslation();
  const currentUserId = getUserId();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["orgChart"],
    queryFn: fetchOrg,
  });

  const rfNodes: Node[] = useMemo(
    () =>
      (data?.positioned ?? []).map((n) =>
        n.kind === "person"
          ? ({
              id: n.id,
              type: "person",
              position: { x: n.x, y: n.y },
              data: { userId: n.userId, name: n.name, deleted: n.deleted, self: n.userId === currentUserId },
              draggable: false,
            } satisfies Node)
          : n.kind === "team"
            ? ({
                id: n.id,
                type: "team",
                position: { x: n.x, y: n.y },
                data: { teamId: n.teamId, name: n.name },
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
    [data, currentUserId],
  );
  const rfEdges: Edge[] = useMemo(
    () =>
      (data?.edges ?? []).map((e) => {
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
    [data],
  );

  return (
    <Stack gap="md" h="100%">
      <Stack gap={4}>
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Title order={2} data-tour="config-org">
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
      </Stack>

      {isError ? (
        <Alert color="red" variant="light" title={t("org.loadFailed")}>
          {error instanceof Error ? error.message : t("org.unknownError")}
        </Alert>
      ) : isLoading ? (
        <Center mih={300}>
          <Loader />
        </Center>
      ) : rfNodes.length === 0 ? (
        <EmptyState
          icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
          label={t("org.empty")}
        />
      ) : (
        <Box style={{ height: "calc(100vh - 240px)", minHeight: 420 }}>
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={NODE_TYPES}
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
