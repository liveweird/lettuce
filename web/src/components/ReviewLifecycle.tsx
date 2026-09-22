import type { ParseKeys } from "i18next";
import { useTranslation } from "react-i18next";
import type { PerformanceReviewStatus } from "../api/reviews";
import LifecycleDiagram, { type LifecycleEdge, type LifecycleNode } from "./LifecycleDiagram";

// A simplified, end-user-facing diagram of how a performance review moves through its states
// (the GoalLifecycle shape, own geometry): every transition is reversible, so there is no
// terminal-node dimming to model. Geometry only — rendering is owned by the shared
// LifecycleDiagram primitive (checkup #37 Tier D1). When `currentStatus` is given, that node is
// highlighted ("you are here").

type NodeDef = { status: PerformanceReviewStatus; x: number; y: number };

const NODE_W = 170;
const NODE_H = 60;

const NODES: NodeDef[] = [
  { status: "DRAFT", x: 20, y: 40 },
  { status: "CALIBRATION", x: 275, y: 40 },
  { status: "PUBLISHED", x: 530, y: 40 },
];

// Paired forward/return edges between neighbouring nodes — every transition can be undone, so
// each pair renders as two parallel arrows, each with its own action caption. The captions are
// longer than the goals diagram's ("Submit for calibration", PL "Wyślij do kalibracji") and would
// not fit the 85-unit gap between nodes, so they sit OUTSIDE the node band — the forward caption
// above the boxes, the return caption below — centred on the gap and free to span the neighbours.
type EdgeDef = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelKey: ParseKeys;
  labelX: number;
  labelY: number;
};

const EDGES: EdgeDef[] = [
  { x1: 190, y1: 67, x2: 275, y2: 67, labelKey: "performanceReview.action.submit", labelX: 232, labelY: 28 },
  { x1: 275, y1: 83, x2: 190, y2: 83, labelKey: "performanceReview.action.revert", labelX: 232, labelY: 124 },
  { x1: 445, y1: 67, x2: 530, y2: 67, labelKey: "performanceReview.action.publish", labelX: 487, labelY: 28 },
  { x1: 530, y1: 83, x2: 445, y2: 83, labelKey: "performanceReview.action.unpublish", labelX: 487, labelY: 124 },
];

export default function ReviewLifecycle({
  currentStatus,
}: {
  currentStatus?: PerformanceReviewStatus;
}) {
  const { t } = useTranslation();
  const nodes: LifecycleNode[] = NODES.map((n) => ({
    id: n.status,
    x: n.x,
    y: n.y,
    label: t(`performanceReview.status.${n.status}`),
  }));
  const edges: LifecycleEdge[] = EDGES.map((e) => ({
    id: e.labelKey,
    x1: e.x1,
    y1: e.y1,
    x2: e.x2,
    y2: e.y2,
    label: t(e.labelKey),
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
      markerId="review-lc-arrow"
      altText={t("performanceReview.lifecycleAlt")}
      hint={t("performanceReview.lifecycleHint")}
    />
  );
}
