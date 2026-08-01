import dagre from "@dagrejs/dagre";

// The org chart's graph model, built from the open teams + users lists (see pages/OrgChart.tsx
// for the fetching). People are unique nodes — a person in several teams (or managing one team
// while belonging to another) renders once with multiple edges, which is what makes the org a
// DAG rather than a tree. This module is pure (dagre runs fine outside the DOM) so the shape
// and the layout are unit-testable; only the lazy org-chart chunk imports it.

export type OrgTeamInput = {
  id: number;
  name: string;
  managerId: number;
  managerName: string;
  managerDeleted: boolean;
};

export type OrgMembership = { teamId: number; memberIds: number[] };

export type OrgPersonNode = { id: string; kind: "person"; userId: number; name: string; deleted: boolean };
export type OrgTeamNode = { id: string; kind: "team"; teamId: number; name: string };
/** The "Not in any team" label heading the unattached-people rows (see layoutOrgGraph). */
export type OrgSectionNode = { id: string; kind: "section" };
export type OrgNode = OrgPersonNode | OrgTeamNode | OrgSectionNode;

export type OrgEdge = {
  id: string;
  source: string;
  target: string;
  kind: "manages" | "member";
};

export type PositionedOrgNode = OrgNode & { x: number; y: number };

// Fixed node boxes: dagre needs sizes up front, and the node components size themselves to
// match (truncating long names) — the FeedbackLifecycle fixed-geometry idiom.
export const PERSON_NODE_SIZE = { width: 220, height: 52 };
export const TEAM_NODE_SIZE = { width: 180, height: 46 };
export const SECTION_NODE_SIZE = { width: 220, height: 24 };

export const UNATTACHED_SECTION_ID = "sec-unattached";

export function personNodeId(userId: number): string {
  return `u${userId}`;
}
export function teamNodeId(teamId: number): string {
  return `t${teamId}`;
}

function sizeOf(node: OrgNode): { width: number; height: number } {
  return node.kind === "person"
    ? PERSON_NODE_SIZE
    : node.kind === "team"
      ? TEAM_NODE_SIZE
      : SECTION_NODE_SIZE;
}

/**
 * Teams + memberships + the id→name map from the users list → unique person/team nodes and
 * manages/member edges. A deleted manager is not in the users list — their name and deleted
 * flag ride on the team row; a member id missing from the map (deleted mid-fetch) is skipped.
 * Every remaining user gets a node too — people in no team (and managing none) must still
 * appear in the chart; they end up edge-less, which is what routes them to the layout's
 * "Not in any team" section.
 */
export function buildOrgGraph(
  teams: OrgTeamInput[],
  memberships: OrgMembership[],
  usersById: Map<number, string>,
): { nodes: OrgNode[]; edges: OrgEdge[] } {
  const persons = new Map<number, OrgPersonNode>();
  const nodes: OrgNode[] = [];
  const edges: OrgEdge[] = [];

  const ensurePerson = (userId: number, name: string, deleted: boolean) => {
    const existing = persons.get(userId);
    if (existing) return existing;
    const node: OrgPersonNode = { id: personNodeId(userId), kind: "person", userId, name, deleted };
    persons.set(userId, node);
    nodes.push(node);
    return node;
  };

  const membersByTeam = new Map(memberships.map((m) => [m.teamId, m.memberIds]));

  for (const team of teams) {
    nodes.push({ id: teamNodeId(team.id), kind: "team", teamId: team.id, name: team.name });
    ensurePerson(team.managerId, team.managerName, team.managerDeleted);
    edges.push({
      id: `manages-${team.id}`,
      source: personNodeId(team.managerId),
      target: teamNodeId(team.id),
      kind: "manages",
    });
    for (const memberId of membersByTeam.get(team.id) ?? []) {
      const name = usersById.get(memberId);
      if (name == null) continue;
      ensurePerson(memberId, name, false);
      edges.push({
        id: `member-${team.id}-${memberId}`,
        source: teamNodeId(team.id),
        target: personNodeId(memberId),
        kind: "member",
      });
    }
  }

  for (const [userId, name] of usersById) ensurePerson(userId, name, false);

  return { nodes, edges };
}

const SECTION_GAP = 64; // clear break between the chart proper and the unattached rows
const SECTION_NODE_GAP = 24; // matches dagre's nodesep
const MIN_SECTION_COLUMNS = 3;

/**
 * Dagre top-to-bottom layout of the edge-attached subgraph. `acyclicer: "greedy"` keeps
 * pathological management cycles (the backend's chain walker tolerates them, so the chart must
 * too) from crashing the layout. Dagre reports node centers; React Flow positions by top-left
 * corner — hence the conversion. Edge-less person nodes (people in no team — a team node always
 * carries its manages edge, so the test is exact) are kept out of dagre: mixed in they would
 * read as managers of nothing. They go into wrapped rows below the chart instead, under an
 * appended "Not in any team" section-label node.
 */
export function layoutOrgGraph(nodes: OrgNode[], edges: OrgEdge[]): PositionedOrgNode[] {
  const attachedIds = new Set<string>();
  for (const edge of edges) {
    attachedIds.add(edge.source);
    attachedIds.add(edge.target);
  }
  const attached = nodes.filter((node) => attachedIds.has(node.id));
  const unattached = nodes.filter((node) => !attachedIds.has(node.id));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 48, nodesep: SECTION_NODE_GAP, acyclicer: "greedy" });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of attached) g.setNode(node.id, { ...sizeOf(node) });
  for (const edge of edges) g.setEdge(edge.source, edge.target);
  dagre.layout(g);
  const positioned = attached.map((node) => {
    const size = sizeOf(node);
    const pos = g.node(node.id);
    return { ...node, x: pos.x - size.width / 2, y: pos.y - size.height / 2 };
  });

  return [...positioned, ...layoutUnattached(unattached, positioned)];
}

/** The "Not in any team" section: a label node, then the people in wrapped rows below it. */
function layoutUnattached(
  unattached: OrgNode[],
  attached: PositionedOrgNode[],
): PositionedOrgNode[] {
  if (unattached.length === 0) return [];
  const left = attached.length > 0 ? Math.min(...attached.map((n) => n.x)) : 0;
  const top =
    attached.length > 0
      ? Math.max(...attached.map((n) => n.y + sizeOf(n).height)) + SECTION_GAP
      : 0;
  // Wrap to roughly the chart's width so the section doesn't stretch the canvas; never fewer
  // than a few columns, or a narrow chart would stack a long skinny column.
  const chartWidth =
    attached.length > 0 ? Math.max(...attached.map((n) => n.x + sizeOf(n).width)) - left : 0;
  const columns = Math.max(
    MIN_SECTION_COLUMNS,
    Math.floor((chartWidth + SECTION_NODE_GAP) / (PERSON_NODE_SIZE.width + SECTION_NODE_GAP)),
  );
  const rowsTop = top + SECTION_NODE_SIZE.height + 12;
  return [
    { id: UNATTACHED_SECTION_ID, kind: "section", x: left, y: top },
    ...unattached.map((node, i) => ({
      ...node,
      x: left + (i % columns) * (PERSON_NODE_SIZE.width + SECTION_NODE_GAP),
      y: rowsTop + Math.floor(i / columns) * (PERSON_NODE_SIZE.height + SECTION_NODE_GAP),
    })),
  ];
}
