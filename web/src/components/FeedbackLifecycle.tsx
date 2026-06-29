import { Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { FeedbackStatus } from "../api/client";

// A simplified, end-user-facing diagram of how a feedback moves through its states. Hand-authored
// inline SVG (no charting dependency); colors use Mantine CSS variables so it follows light/dark
// mode. The delete path is intentionally omitted — a deleted feedback is gone, so it isn't a state
// an end-user viewing a feedback would ever be in. When `currentStatus` is given, that node is
// highlighted ("you are here").

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

// Directional edges as [x1, y1, x2, y2], drawn between node anchor points.
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
  return (
    <Stack gap="xs" align="center">
      <svg
        role="img"
        aria-label={t("feedback.lifecycleAlt")}
        viewBox="0 0 680 220"
        style={{ width: "100%", maxWidth: 680, height: "auto" }}
      >
        <defs>
          <marker
            id="lc-arrow"
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
        {ARROWS.map(([x1, y1, x2, y2], i) => (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--mantine-color-dimmed)"
            strokeWidth={1.5}
            markerEnd="url(#lc-arrow)"
          />
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
                fill={n.terminal && !active ? "var(--mantine-color-dimmed)" : "var(--mantine-color-text)"}
              >
                {t(`common.status.${n.status}`)}
              </text>
            </g>
          );
        })}
      </svg>
      <Text size="sm" c="dimmed" ta="center">
        {t("feedback.lifecycleHint")}
      </Text>
    </Stack>
  );
}
