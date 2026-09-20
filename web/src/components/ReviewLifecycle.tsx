import type { ParseKeys } from "i18next";
import { Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { PerformanceReviewStatus } from "../api/reviews";

// A simplified, end-user-facing diagram of how a performance review moves through its states
// (the GoalLifecycle shape, own geometry): every transition is reversible, so there is no
// terminal-node dimming to model. Hand-authored inline SVG (no charting dependency); colors use
// Mantine CSS variables so it follows light/dark mode. When `currentStatus` is given, that node
// is highlighted ("you are here").

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
  return (
    <Stack gap="xs" align="center">
      <svg
        role="img"
        aria-label={t("performanceReview.lifecycleAlt")}
        viewBox="0 0 720 150"
        style={{ width: "100%", maxWidth: 720, height: "auto" }}
      >
        <defs>
          <marker
            id="review-lc-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--mantine-color-dimmed)" />
          </marker>
        </defs>
        {EDGES.map((e) => (
          <g key={e.labelKey}>
            <line
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke="var(--mantine-color-dimmed)"
              strokeWidth={1.5}
              markerEnd="url(#review-lc-arrow)"
            />
            <text x={e.labelX} y={e.labelY} textAnchor="middle" fontSize={13} fill="var(--mantine-color-dimmed)">
              {t(e.labelKey)}
            </text>
          </g>
        ))}
        {NODES.map((n) => {
          const active = n.status === currentStatus;
          const cx = n.x + NODE_W / 2;
          const cy = n.y + NODE_H / 2;
          return (
            <g key={n.status}>
              <rect
                x={n.x}
                y={n.y}
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={active ? "var(--mantine-primary-color-light)" : "var(--mantine-color-body)"}
                stroke={active ? "var(--mantine-primary-color-filled)" : "var(--mantine-color-default-border)"}
                strokeWidth={active ? 2 : 1}
              />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={14}
                fontWeight={active ? 600 : 400}
                fill="var(--mantine-color-text)"
              >
                {t(`performanceReview.status.${n.status}`)}
              </text>
            </g>
          );
        })}
      </svg>
      <Text size="sm" c="dimmed" ta="center">
        {t("performanceReview.lifecycleHint")}
      </Text>
    </Stack>
  );
}
