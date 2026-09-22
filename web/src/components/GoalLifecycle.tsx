import { useTranslation } from "react-i18next";
import type { GoalStatus } from "../api/goals";
import type { TeamKpiStatus } from "../api/teamkpis";
import LifecycleDiagram, { type LifecycleEdge, type LifecycleNode } from "./LifecycleDiagram";

// A simplified, end-user-facing diagram of how a goal (or, since v3.20.0, a team KPI — the
// identical DRAFT/ACTIVE/ARCHIVED machine) moves through its states (the FeedbackLifecycle
// shape, own geometry — every transition is reversible, so there is no terminal-node dimming to
// model). Geometry only — rendering is owned by the shared LifecycleDiagram primitive (checkup
// #37 Tier D1). When `currentStatus` is given, that node is highlighted ("you are here").
// `keyPrefix` (the GoalCloseModal precedent) picks the locale area every label derives from —
// "goal" (default) or "teamKpi", each defining the same status.*/action.*/lifecycleAlt/
// lifecycleHint keys.

type LifecycleStatus = GoalStatus | TeamKpiStatus;

type NodeDef = { status: LifecycleStatus; x: number; y: number };

const NODE_W = 170;
const NODE_H = 60;

const NODES: NodeDef[] = [
  { status: "DRAFT", x: 20, y: 40 },
  { status: "ACTIVE", x: 275, y: 40 },
  { status: "ARCHIVED", x: 530, y: 40 },
];

// Paired forward/return edges between neighbouring nodes — every transition can be undone, so
// each pair renders as two parallel arrows, each with its own action caption. The action name is
// resolved against `${keyPrefix}.action.<action>` at render time, so the edge geometry itself
// stays keyPrefix-agnostic.
type EdgeDef = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  action: "activate" | "deactivate" | "close" | "reopen";
  labelX: number;
  labelY: number;
};

const EDGES: EdgeDef[] = [
  { x1: 190, y1: 67, x2: 275, y2: 67, action: "activate", labelX: 232, labelY: 55 },
  { x1: 275, y1: 83, x2: 190, y2: 83, action: "deactivate", labelX: 232, labelY: 108 },
  { x1: 445, y1: 67, x2: 530, y2: 67, action: "close", labelX: 487, labelY: 55 },
  { x1: 530, y1: 83, x2: 445, y2: 83, action: "reopen", labelX: 487, labelY: 108 },
];

export default function GoalLifecycle({
  currentStatus,
  keyPrefix = "goal",
}: {
  currentStatus?: LifecycleStatus;
  keyPrefix?: "goal" | "teamKpi";
}) {
  const { t } = useTranslation();
  const markerId = `${keyPrefix}-lc-arrow`;
  const nodes: LifecycleNode[] = NODES.map((n) => ({
    id: n.status,
    x: n.x,
    y: n.y,
    label: t(`${keyPrefix}.status.${n.status}`),
  }));
  const edges: LifecycleEdge[] = EDGES.map((e) => ({
    id: e.action,
    x1: e.x1,
    y1: e.y1,
    x2: e.x2,
    y2: e.y2,
    label: t(`${keyPrefix}.action.${e.action}`),
    labelX: e.labelX,
    labelY: e.labelY,
  }));
  return (
    <LifecycleDiagram
      viewBox="0 0 720 150"
      width={720}
      nodeWidth={NODE_W}
      nodeHeight={NODE_H}
      nodes={nodes}
      edges={edges}
      currentId={currentStatus}
      markerId={markerId}
      altText={t(`${keyPrefix}.lifecycleAlt`)}
      hint={t(`${keyPrefix}.lifecycleHint`)}
    />
  );
}
