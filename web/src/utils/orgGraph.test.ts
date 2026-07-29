import { describe, expect, test } from "vitest";
import {
  buildOrgGraph,
  layoutOrgGraph,
  personNodeId,
  PERSON_NODE_SIZE,
  teamNodeId,
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
]);

describe("buildOrgGraph", () => {
  test("builds unique person nodes with manages and member edges", () => {
    const { nodes, edges } = buildOrgGraph(TEAMS, MEMBERSHIPS, USERS);

    // 6 people (each once, despite Manager AAA appearing as manager AND member) + 3 teams.
    expect(nodes.filter((n) => n.kind === "person")).toHaveLength(6);
    expect(nodes.filter((n) => n.kind === "team")).toHaveLength(3);

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

describe("layoutOrgGraph", () => {
  test("positions every node, converting dagre centers to top-left corners", () => {
    const { nodes, edges } = buildOrgGraph(TEAMS, MEMBERSHIPS, USERS);
    const positioned = layoutOrgGraph(nodes, edges);

    expect(positioned).toHaveLength(nodes.length);
    for (const node of positioned) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    // TB layout: the top manager (CCC's, who manages the root team) sits above their team.
    const grand = positioned.find((n) => n.id === personNodeId(12))!;
    const grandTeam = positioned.find((n) => n.id === teamNodeId(3))!;
    expect(grand.y + PERSON_NODE_SIZE.height).toBeLessThanOrEqual(grandTeam.y);
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
