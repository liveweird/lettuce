import { describe, expect, test } from "vitest";
import {
  applyCollapse,
  buildOrgGraph,
  layoutOrgGraph,
  personNodeId,
  PERSON_NODE_SIZE,
  teamNodeId,
  UNATTACHED_SECTION_ID,
  type OrgMembership,
  type OrgTeamInput,
} from "./orgGraph";

const TEAMS: OrgTeamInput[] = [
  { id: 1, name: "AAA", managerId: 10, managerName: "Manager AAA", managerDeleted: false },
  { id: 2, name: "BBB", managerId: 11, managerName: "Manager BBB", managerDeleted: false },
  { id: 3, name: "CCC", managerId: 12, managerName: "Manager CCC", managerDeleted: false },
];
// Managers AAA + BBB are members of CCC — the member-who-manages DAG shape.
const MEMBERSHIPS: OrgMembership[] = [
  { teamId: 1, memberIds: [1, 2] },
  { teamId: 2, memberIds: [3] },
  { teamId: 3, memberIds: [10, 11] },
];
const USERS = new Map<number, string>([
  [1, "AAA One"],
  [2, "AAA Two"],
  [3, "BBB One"],
  [10, "Manager AAA"],
  [11, "Manager BBB"],
  [12, "Manager CCC"],
  [99, "Floater"], // in no team, manages none — must still get a node
]);

describe("buildOrgGraph", () => {
  test("builds unique person nodes with manages and member edges", () => {
    const { nodes, edges } = buildOrgGraph(TEAMS, MEMBERSHIPS, USERS);

    // 7 people (each once, despite Manager AAA appearing as manager AND member; the teamless
    // Floater included) + 3 teams.
    expect(nodes.filter((n) => n.kind === "person")).toHaveLength(7);
    expect(nodes.filter((n) => n.kind === "team")).toHaveLength(3);
    // The teamless user's node exists and carries no edge — the layout's section test relies
    // on exactly this shape.
    expect(nodes).toContainEqual({
      id: personNodeId(99),
      kind: "person",
      userId: 99,
      name: "Floater",
      deleted: false,
    });
    expect(edges.some((e) => e.source === personNodeId(99) || e.target === personNodeId(99))).toBe(
      false,
    );

    // One manages edge per team, one member edge per membership row.
    expect(edges.filter((e) => e.kind === "manages")).toHaveLength(3);
    expect(edges.filter((e) => e.kind === "member")).toHaveLength(5);

    // The DAG shape: Manager AAA is CCC's member AND AAA's manager — same node both times.
    expect(edges).toContainEqual({
      id: "member-3-10",
      source: teamNodeId(3),
      target: personNodeId(10),
      kind: "member",
    });
    expect(edges).toContainEqual({
      id: "manages-1",
      source: personNodeId(10),
      target: teamNodeId(1),
      kind: "manages",
    });
  });

  test("a deleted manager keeps the flag from the team row; unknown members are skipped", () => {
    const { nodes, edges } = buildOrgGraph(
      [{ id: 9, name: "Orphan", managerId: 42, managerName: "Zed", managerDeleted: true }],
      [{ teamId: 9, memberIds: [1, 999] }], // 999 is not in the users map
      new Map([[1, "AAA One"]]),
    );

    const zed = nodes.find((n) => n.kind === "person" && n.userId === 42);
    expect(zed).toMatchObject({ name: "Zed", deleted: true });
    expect(nodes.find((n) => n.kind === "person" && n.userId === 999)).toBeUndefined();
    expect(edges.filter((e) => e.kind === "member")).toHaveLength(1);
  });

  test("a manager present in the users map is not duplicated by a membership row", () => {
    const { nodes } = buildOrgGraph(
      TEAMS.slice(0, 1),
      [{ teamId: 1, memberIds: [10] }], // pathological: the manager listed as their own member
      USERS,
    );
    expect(nodes.filter((n) => n.kind === "person" && n.userId === 10)).toHaveLength(1);
  });
});

describe("applyCollapse", () => {
  test("an empty set is the identity", () => {
    const { nodes, edges } = buildOrgGraph(TEAMS, MEMBERSHIPS, USERS);
    const result = applyCollapse(nodes, edges, new Set());
    expect(result.nodes).toBe(nodes);
    expect(result.edges).toBe(edges);
  });

  test("collapsing a leaf team hides its members but keeps the team and its manages edge", () => {
    const { nodes, edges } = buildOrgGraph(TEAMS, MEMBERSHIPS, USERS);
    const result = applyCollapse(nodes, edges, new Set([teamNodeId(1)]));

    // AAA's members (1, 2) fold away; the team node, its manager, and everyone else stay.
    const ids = result.nodes.map((n) => n.id);
    expect(ids).not.toContain(personNodeId(1));
    expect(ids).not.toContain(personNodeId(2));
    expect(ids).toContain(teamNodeId(1));
    expect(ids).toContain(personNodeId(10));
    expect(ids).toContain(personNodeId(99)); // the floater is untouched
    expect(result.edges.map((e) => e.id)).not.toContain("member-1-1");
    expect(result.edges.map((e) => e.id)).toContain("manages-1");
  });

  test("collapsing the root team cascades through hidden members' own subtrees", () => {
    const { nodes, edges } = buildOrgGraph(TEAMS, MEMBERSHIPS, USERS);
    const result = applyCollapse(nodes, edges, new Set([teamNodeId(3)]));

    // CCC's members are Managers AAA/BBB — hiding them drags AAA/BBB and their members away.
    // Left: Manager CCC, the collapsed CCC node, the teamless floater, and only the CCC
    // manages edge.
    expect(result.nodes.map((n) => n.id).sort()).toEqual(
      [personNodeId(12), personNodeId(99), teamNodeId(3)].sort(),
    );
    expect(result.edges.map((e) => e.id)).toEqual(["manages-3"]);
  });

  test("a member reachable through another expanded team survives the collapse", () => {
    const teams: OrgTeamInput[] = [
      { id: 1, name: "A", managerId: 10, managerName: "M1", managerDeleted: false },
      { id: 2, name: "B", managerId: 11, managerName: "M2", managerDeleted: false },
    ];
    const memberships: OrgMembership[] = [
      { teamId: 1, memberIds: [5] },
      { teamId: 2, memberIds: [5] }, // the same person sits in both teams
    ];
    const users = new Map([
      [5, "Shared"],
      [10, "M1"],
      [11, "M2"],
    ]);
    const { nodes, edges } = buildOrgGraph(teams, memberships, users);
    const result = applyCollapse(nodes, edges, new Set([teamNodeId(1)]));

    expect(result.nodes.map((n) => n.id)).toContain(personNodeId(5));
    const edgeIds = result.edges.map((e) => e.id);
    expect(edgeIds).not.toContain("member-1-5");
    expect(edgeIds).toContain("member-2-5");
  });
});

describe("layoutOrgGraph", () => {
  test("positions every node, converting dagre centers to top-left corners", () => {
    const { nodes, edges } = buildOrgGraph(TEAMS, MEMBERSHIPS, USERS);
    const positioned = layoutOrgGraph(nodes, edges);

    // Every node plus the appended "Not in any team" section label (Floater is unattached).
    expect(positioned).toHaveLength(nodes.length + 1);
    for (const node of positioned) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    // LR layout: the top manager (CCC's, who manages the root team) sits left of their team.
    const grand = positioned.find((n) => n.id === personNodeId(12))!;
    const grandTeam = positioned.find((n) => n.id === teamNodeId(3))!;
    expect(grand.x + PERSON_NODE_SIZE.width).toBeLessThanOrEqual(grandTeam.x);
  });

  test("teamless people land below the chart, under the section label", () => {
    const { nodes, edges } = buildOrgGraph(TEAMS, MEMBERSHIPS, USERS);
    const positioned = layoutOrgGraph(nodes, edges);

    const section = positioned.find((n) => n.id === UNATTACHED_SECTION_ID)!;
    expect(section.kind).toBe("section");
    const floater = positioned.find((n) => n.id === personNodeId(99))!;
    // The whole chart proper (everyone with an edge) sits above the section, which sits above
    // the teamless row. A manager who belongs to no team (Manager CCC) stays in the chart.
    const chartBottom = Math.max(
      ...positioned
        .filter((n) => n.id !== UNATTACHED_SECTION_ID && n.id !== personNodeId(99))
        .map((n) => n.y),
    );
    expect(section.y).toBeGreaterThan(chartBottom);
    expect(floater.y).toBeGreaterThan(section.y);
  });

  test("no section node when everyone is attached to a team", () => {
    const attachedOnly = new Map([...USERS].filter(([id]) => id !== 99));
    const { nodes, edges } = buildOrgGraph(TEAMS, MEMBERSHIPS, attachedOnly);
    const positioned = layoutOrgGraph(nodes, edges);

    expect(positioned).toHaveLength(nodes.length);
    expect(positioned.some((n) => n.kind === "section")).toBe(false);
  });

  test("with no teams at all, the section starts at the top and the rows wrap", () => {
    const users = new Map([
      [1, "A"],
      [2, "B"],
      [3, "C"],
      [4, "D"],
    ]);
    const { nodes, edges } = buildOrgGraph([], [], users);
    const positioned = layoutOrgGraph(nodes, edges);

    const section = positioned.find((n) => n.id === UNATTACHED_SECTION_ID)!;
    expect(section).toMatchObject({ x: 0, y: 0 });
    // Minimum three columns: the fourth person wraps to a second row, under the first.
    const first = positioned.find((n) => n.id === personNodeId(1))!;
    const fourth = positioned.find((n) => n.id === personNodeId(4))!;
    expect(fourth.x).toBe(first.x);
    expect(fourth.y).toBeGreaterThan(first.y);
  });

  test("survives a management cycle (the acyclicer breaks it instead of throwing)", () => {
    const cyclic: OrgTeamInput[] = [
      { id: 1, name: "A", managerId: 1, managerName: "X", managerDeleted: false },
      { id: 2, name: "B", managerId: 2, managerName: "Y", managerDeleted: false },
    ];
    const memberships: OrgMembership[] = [
      { teamId: 1, memberIds: [2] }, // Y is a member of X's team...
      { teamId: 2, memberIds: [1] }, // ...and X is a member of Y's team.
    ];
    const users = new Map([
      [1, "X"],
      [2, "Y"],
    ]);
    const { nodes, edges } = buildOrgGraph(cyclic, memberships, users);
    expect(() => layoutOrgGraph(nodes, edges)).not.toThrow();
    expect(layoutOrgGraph(nodes, edges)).toHaveLength(4);
  });
});
