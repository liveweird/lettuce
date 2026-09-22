import { useTranslation } from "react-i18next";
import type { FeedbackStatus } from "../api/feedbacks";
import LifecycleDiagram, { type LifecycleEdge, type LifecycleNode } from "./LifecycleDiagram";

// A simplified, end-user-facing diagram of how a feedback moves through its states. Geometry only
// — rendering is owned by the shared LifecycleDiagram primitive (checkup #37 Tier D1). The delete
// path is intentionally omitted — a deleted feedback is gone, so it isn't a state an end-user
// viewing a feedback would ever be in. When `currentStatus` is given, that node is highlighted
// ("you are here").

type NodeDef = { status: FeedbackStatus; x: number; y: number; terminal?: boolean };

const NODE_W = 150;
const NODE_H = 46;

const NODES: NodeDef[] = [
  { status: "REQUESTED", x: 20, y: 30 },
  { status: "DRAFT", x: 265, y: 30 },
  { status: "SENT", x: 510, y: 30 },
  { status: "REJECTED", x: 20, y: 160, terminal: true },
  { status: "WITHDRAWN", x: 387, y: 160, terminal: true },
];

// Directional edges as [x1, y1, x2, y2], drawn between node anchor points — no captions (the
// terminal-dimming shape needs none; GoalLifecycle/ReviewLifecycle's paired-action edges do).
const ARROWS: ReadonlyArray<readonly [number, number, number, number]> = [
  [170, 53, 257, 53], // Requested → Draft
  [415, 53, 502, 53], // Draft → Sent
  [95, 76, 95, 152], // Requested → Rejected
  [340, 76, 440, 152], // Draft → Withdrawn
  [585, 76, 497, 152], // Sent → Withdrawn
];

export default function FeedbackLifecycle({
  currentStatus,
}: {
  currentStatus?: FeedbackStatus;
}) {
  const { t } = useTranslation();
  const nodes: LifecycleNode[] = NODES.map((n) => ({
    id: n.status,
    x: n.x,
    y: n.y,
    terminal: n.terminal,
    label: t(`common.status.${n.status}`),
  }));
  const edges: LifecycleEdge[] = ARROWS.map(([x1, y1, x2, y2], i) => ({
    id: String(i),
    x1,
    y1,
    x2,
    y2,
  }));
  return (
    <LifecycleDiagram
      viewBox="0 0 680 220"
      width={680}
      nodeWidth={NODE_W}
      nodeHeight={NODE_H}
      nodes={nodes}
      edges={edges}
      currentId={currentStatus}
      markerId="lc-arrow"
      altText={t("feedback.lifecycleAlt")}
      hint={t("feedback.lifecycleHint")}
    />
  );
}
