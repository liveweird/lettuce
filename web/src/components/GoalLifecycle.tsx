import type { ParseKeys } from "i18next";
import { Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { GoalStatus } from "../api/goals";

// A simplified, end-user-facing diagram of how a goal moves through its states (the
// FeedbackLifecycle shape, own geometry — every goal transition is reversible, so there is no
// terminal-node dimming to model). Hand-authored inline SVG (no charting dependency); colors use
// Mantine CSS variables so it follows light/dark mode. When `currentStatus` is given, that node
// is highlighted ("you are here").

type NodeDef = { status: GoalStatus; x: number; y: number };

const NODE_W = 170;
const NODE_H = 60;

const NODES: NodeDef[] = [
  { status: "DRAFT", x: 20, y: 40 },
  { status: "ACTIVE", x: 275, y: 40 },
  { status: "ARCHIVED", x: 530, y: 40 },
];

// Paired forward/return edges between neighbouring nodes — every transition can be undone, so
// each pair renders as two parallel arrows, each with its own action caption.
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
  { x1: 190, y1: 67, x2: 275, y2: 67, labelKey: "goal.action.activate", labelX: 232, labelY: 55 },
  { x1: 275, y1: 83, x2: 190, y2: 83, labelKey: "goal.action.deactivate", labelX: 232, labelY: 108 },
  { x1: 445, y1: 67, x2: 530, y2: 67, labelKey: "goal.action.close", labelX: 487, labelY: 55 },
  { x1: 530, y1: 83, x2: 445, y2: 83, labelKey: "goal.action.reopen", labelX: 487, labelY: 108 },
];

export default function GoalLifecycle({
  currentStatus,
}: {
  currentStatus?: GoalStatus;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs" align="center">
      <svg
        role="img"
        aria-label={t("goal.lifecycleAlt")}
        viewBox="0 0 720 150"
        style={{ width: "100%", maxWidth: 720, height: "auto" }}
      >
        <defs>
          <marker
            id="goal-lc-arrow"
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
              markerEnd="url(#goal-lc-arrow)"
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
                {t(`goal.status.${n.status}`)}
              </text>
            </g>
          );
        })}
      </svg>
      <Text size="sm" c="dimmed" ta="center">
        {t("goal.lifecycleHint")}
      </Text>
    </Stack>
  );
}
