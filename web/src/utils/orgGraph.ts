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
export type OrgNode = OrgPersonNode | OrgTeamNode;

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

export function personNodeId(userId: number): string {
  return `u${userId}`;
}
export function teamNodeId(teamId: number): string {
  return `t${teamId}`;
}

/**
 * Teams + memberships + the id→name map from the users list → unique person/team nodes and
 * manages/member edges. A deleted manager is not in the users list — their name and deleted
 * flag ride on the team row; a member id missing from the map (deleted mid-fetch) is skipped.
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

  return { nodes, edges };
}

/**
 * Dagre top-to-bottom layout. `acyclicer: "greedy"` keeps pathological management cycles (the
 * backend's chain walker tolerates them, so the chart must too) from crashing the layout.
 * Dagre reports node centers; React Flow positions by top-left corner — hence the conversion.
 */
export function layoutOrgGraph(nodes: OrgNode[], edges: OrgEdge[]): PositionedOrgNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 48, nodesep: 24, acyclicer: "greedy" });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) {
    g.setNode(node.id, { ...(node.kind === "person" ? PERSON_NODE_SIZE : TEAM_NODE_SIZE) });
  }
  for (const edge of edges) g.setEdge(edge.source, edge.target);
  dagre.layout(g);
  return nodes.map((node) => {
    const size = node.kind === "person" ? PERSON_NODE_SIZE : TEAM_NODE_SIZE;
    const pos = g.node(node.id);
    return { ...node, x: pos.x - size.width / 2, y: pos.y - size.height / 2 };
  });
}
